import { App, TFile, moment, Component } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { VersionControlSettings, NoteManifest } from "../types";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";
import { PathService } from "./storage/path-service";

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 * Extends Component to leverage automatic event listener cleanup.
 */
export class CleanupManager extends Component {
    private app: App;
    private manifestManager: ManifestManager;
    private settingsProvider: () => VersionControlSettings;
    private eventBus: PluginEvents;
    private pathService: PathService;
    
    private cleanupPromises = new Map<string, Promise<void>>();
    private isOrphanCleanupRunning = false;

    constructor(
        app: App, 
        manifestManager: ManifestManager, 
        settingsProvider: () => VersionControlSettings,
        eventBus: PluginEvents,
        pathService: PathService
    ) {
        super();
        this.app = app;
        this.manifestManager = manifestManager;
        this.settingsProvider = settingsProvider;
        this.eventBus = eventBus;
        this.pathService = pathService;
    }

    /**
     * Registers event listeners on the event bus. This should be called
     * once during plugin initialization.
     */
    public initialize(): void {
        this.registerEvent(this.eventBus.on('version-saved', this.handleVersionSaved));
    }

    /**
     * Event handler that triggers a per-note cleanup when a new version is saved.
     */
    private handleVersionSaved = (noteId: string): void => {
        this.scheduleCleanup(noteId);
    }

    /**
     * Schedules a cleanup operation for a specific note, ensuring that only one
     * cleanup process runs at a time for the same note.
     * @param noteId The ID of the note to clean up.
     */
    public scheduleCleanup(noteId: string): void {
        if (this.cleanupPromises.has(noteId)) {
            return; 
        }
        const cleanupPromise = this.performPerNoteCleanup(noteId)
            .catch(error => {
                console.error(`VC: Error during scheduled cleanup for note ${noteId}.`, error);
            })
            .finally(() => {
                this.cleanupPromises.delete(noteId);
            });
        this.cleanupPromises.set(noteId, cleanupPromise);
    }

    private async performPerNoteCleanup(noteId: string): Promise<void> {
        const settings = this.settingsProvider();
        const { maxVersionsPerNote, autoCleanupOldVersions, autoCleanupDays } = settings;

        if ((maxVersionsPerNote <= 0) && (!autoCleanupOldVersions || autoCleanupDays <= 0)) {
            return;
        }

        const versionsToDelete = new Set<string>();

        // First, determine which versions to delete without holding a lock
        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest || Object.keys(noteManifest.versions).length <= 1) {
            return;
        }

        const versions = Object.entries(noteManifest.versions);

        // Determine versions to delete by age
        if (autoCleanupOldVersions && autoCleanupDays > 0) {
            const cutoffDate = moment().subtract(autoCleanupDays, 'days');
            versions.forEach(([versionId, versionData]) => {
                if (versions.length - versionsToDelete.size > 1 && moment(versionData.timestamp).isBefore(cutoffDate)) {
                    versionsToDelete.add(versionId);
                }
            });
        }

        // Determine versions to delete by count
        if (maxVersionsPerNote > 0) {
            const remainingVersions = versions.filter(([versionId]) => !versionsToDelete.has(versionId));
            if (remainingVersions.length > maxVersionsPerNote) {
                remainingVersions.sort(([, a], [, b]) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                const numberToExceedCount = remainingVersions.length - maxVersionsPerNote;
                for (let i = 0; i < numberToExceedCount; i++) {
                    versionsToDelete.add(remainingVersions[i][0]);
                }
            }
        }

        if (versionsToDelete.size > 0) {
            console.log(`VC: Identified ${versionsToDelete.size} old versions to cleanup for note ${noteId}.`);
            
            // Now, perform the manifest update atomically using the queue
            await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                for (const versionId of versionsToDelete) {
                    delete manifest.versions[versionId];
                }
                manifest.lastModified = new Date().toISOString();
                return manifest;
            });

            // After the manifest is safely updated, delete the files.
            // This is not critical if it fails; orphan cleanup can get them later.
            const deletionPromises = Array.from(versionsToDelete).map(versionId => {
                const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
                return this.app.vault.adapter.exists(versionFilePath)
                    .then(exists => exists ? this.app.vault.adapter.remove(versionFilePath) : Promise.resolve())
                    .catch(fileError => {
                        console.error(`VC: Failed to delete version file ${versionFilePath} during cleanup.`, fileError);
                    });
            });

            await Promise.allSettled(deletionPromises);

            this.eventBus.trigger('version-deleted', noteId);
            console.log(`VC: Successfully cleaned up ${versionsToDelete.size} old versions for note ${noteId}.`);
        }
    }

    async cleanupOrphanedVersions(manualTrigger: boolean): Promise<{ count: number, success: boolean }> {
        const settings = this.settingsProvider();
        if (!settings.autoCleanupOrphanedVersions && !manualTrigger) {
            return { count: 0, success: true };
        }
        if (this.isOrphanCleanupRunning) {
            console.log("VC: Orphan cleanup is already in progress. Skipping this run.");
            return { count: 0, success: true };
        }
        this.isOrphanCleanupRunning = true;

        try {
            const centralManifest = await this.manifestManager.loadCentralManifest(true);
            if (!centralManifest || !centralManifest.notes) {
                console.warn("VC: Central manifest is empty or invalid. Skipping orphan cleanup.");
                return { count: 0, success: true };
            }

            // Build a map of all vc-ids and a set of all paths in a single pass for efficiency.
            const allVcIdsInVault = new Map<string, string>();
            const allVaultFilePaths = new Set<string>();
            for (const file of this.app.vault.getMarkdownFiles()) {
                allVaultFilePaths.add(file.path);
                const cache = this.app.metadataCache.getFileCache(file);
                const vcId = cache?.frontmatter?.[NOTE_FRONTMATTER_KEY];
                if (typeof vcId === 'string' && vcId.trim() !== '') {
                    allVcIdsInVault.set(vcId, file.path);
                }
            }

            const orphanedNoteIdsToDelete: string[] = [];
            const pathsToUpdate: { noteId: string, newPath: string }[] = [];

            for (const [noteId, noteData] of Object.entries(centralManifest.notes)) {
                if (!noteData || typeof noteData.notePath !== 'string') {
                    console.warn(`VC: Corrupted entry in central manifest for ID ${noteId}. Removing. Data:`, JSON.stringify(noteData));
                    orphanedNoteIdsToDelete.push(noteId);
                    continue;
                }

                const noteFileExists = allVaultFilePaths.has(noteData.notePath);

                if (noteFileExists) {
                    // File exists at the path we expect. Verify its vc-id matches.
                    const file = this.app.vault.getAbstractFileByPath(noteData.notePath) as TFile;
                    const fileCache = this.app.metadataCache.getFileCache(file);
                    let idFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
                    if (typeof idFromFrontmatter === 'string' && idFromFrontmatter.trim() === '') {
                        idFromFrontmatter = null;
                    }

                    if (idFromFrontmatter !== noteId) {
                        // The file at the path is no longer associated with this history.
                        console.log(`VC (Orphan): Mismatched vc-id for note ID ${noteId} at path "${noteData.notePath}". Manifest ID: ${noteId}, File FM ID: "${idFromFrontmatter}". Scheduling data deletion.`);
                        orphanedNoteIdsToDelete.push(noteId);
                    }
                } else {
                    // File does NOT exist at the path. Check if it was renamed.
                    const newPathForId = allVcIdsInVault.get(noteId);
                    if (newPathForId) {
                        // The file was renamed! Self-heal by updating the path.
                        console.log(`VC (Orphan): Detected renamed file for note ID ${noteId}. Old path: "${noteData.notePath}", New path: "${newPathForId}". Scheduling path update.`);
                        pathsToUpdate.push({ noteId, newPath: newPathForId });
                    } else {
                        // The file is truly gone.
                        console.log(`VC (Orphan): File not found for note ID ${noteId} at path "${noteData.notePath}" and ID not found elsewhere. Scheduling data deletion.`);
                        orphanedNoteIdsToDelete.push(noteId);
                    }
                }
            }

            // Perform updates and deletions
            if (pathsToUpdate.length > 0) {
                const updatePromises = pathsToUpdate.map(update => this.manifestManager.updateNotePath(update.noteId, update.newPath));
                await Promise.allSettled(updatePromises);
                console.log(`VC: Orphan cleanup self-healed ${pathsToUpdate.length} renamed file path(s).`);
            }

            if (orphanedNoteIdsToDelete.length > 0) {
                const deletionPromises = orphanedNoteIdsToDelete.map(id => this.manifestManager.deleteNoteEntry(id));
                await Promise.allSettled(deletionPromises);
                
                // Emit event for each successfully deleted history
                orphanedNoteIdsToDelete.forEach(id => this.eventBus.trigger('history-deleted', id));

                console.log(`VC: Orphan cleanup removed ${orphanedNoteIdsToDelete.length} histor${orphanedNoteIdsToDelete.length > 1 ? 'ies' : 'y'}.`);
            }
            return { count: orphanedNoteIdsToDelete.length, success: true };

        } catch (error) {
            console.error("VC: Unexpected error during orphaned version cleanup.", error);
            return { count: 0, success: false };
        } finally {
            this.isOrphanCleanupRunning = false;
        }
    }

    async completePendingCleanups(): Promise<void> {
        const pending = Array.from(this.cleanupPromises.values());
        if (pending.length > 0) {
            console.log(`VC: Waiting for ${pending.length} pending per-note cleanups...`);
            await Promise.allSettled(pending);
            console.log("VC: All pending per-note cleanups completed.");
        }
        this.cleanupPromises.clear();
    }
}
