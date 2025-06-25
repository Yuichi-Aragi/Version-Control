import { App, TFile, moment } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { VersionControlSettings, NoteManifest } from "../types";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 */
export class CleanupManager {
    private app: App;
    private manifestManager: ManifestManager;
    private settingsProvider: () => VersionControlSettings;
    private eventBus: PluginEvents;
    
    private cleanupPromises = new Map<string, Promise<void>>();
    private isOrphanCleanupRunning = false;

    constructor(
        app: App, 
        manifestManager: ManifestManager, 
        settingsProvider: () => VersionControlSettings,
        eventBus: PluginEvents
    ) {
        this.app = app;
        this.manifestManager = manifestManager;
        this.settingsProvider = settingsProvider;
        this.eventBus = eventBus;
    }

    /**
     * Registers event listeners on the event bus. This should be called
     * once during plugin initialization.
     */
    public initialize(): void {
        this.eventBus.on('version-saved', this.handleVersionSaved);
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

        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest || Object.keys(noteManifest.versions).length <= 1) {
            return;
        }

        const versions = Object.entries(noteManifest.versions);
        const versionsToDelete = new Set<string>();

        if (autoCleanupOldVersions && autoCleanupDays > 0) {
            const cutoffDate = moment().subtract(autoCleanupDays, 'days');
            versions.forEach(([versionId, versionData]) => {
                if (versions.length - versionsToDelete.size > 1 && moment(versionData.timestamp).isBefore(cutoffDate)) {
                    versionsToDelete.add(versionId);
                }
            });
        }

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
            await this.deleteMultipleVersions(noteManifest, Array.from(versionsToDelete));
        }
    }

    private async deleteMultipleVersions(noteManifest: NoteManifest, versionIdsToDelete: string[]): Promise<void> {
        let deletedCount = 0;
        const deletionPromises: Promise<void>[] = [];
        const failedFileDeletions: string[] = [];

        for (const versionId of versionIdsToDelete) {
            const versionData = noteManifest.versions[versionId];
            if (versionData) {
                delete noteManifest.versions[versionId];
                deletedCount++;
                
                deletionPromises.push(
                    (async () => {
                        try {
                            const versionFilePath = this.manifestManager.getNoteVersionPath(noteManifest.noteId, versionId);
                            if (await this.app.vault.adapter.exists(versionFilePath)) {
                                await this.app.vault.adapter.remove(versionFilePath);
                            }
                        } catch (fileError) {
                            const versionFilePath = this.manifestManager.getNoteVersionPath(noteManifest.noteId, versionId);
                            failedFileDeletions.push(versionFilePath);
                            console.error(`VC: Failed to delete version file ${versionFilePath} during cleanup.`, fileError);
                        }
                    })()
                );
            }
        }

        await Promise.allSettled(deletionPromises);

        if (failedFileDeletions.length > 0) {
            console.error(`VC: Failed to delete ${failedFileDeletions.length} version files during cleanup for note ${noteManifest.noteId}. Paths:`, failedFileDeletions);
        }

        if (deletedCount > 0) {
            noteManifest.lastModified = new Date().toISOString();
            await this.manifestManager.saveNoteManifest(noteManifest);
            this.eventBus.trigger('version-deleted', noteManifest.noteId);
            console.log(`VC: Successfully cleaned up ${deletedCount} old versions for note ${noteManifest.noteId}.`);
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

            const allVaultFilePaths = new Set(this.app.vault.getMarkdownFiles().map(f => f.path));
            const orphanedNoteIdsToDelete: string[] = [];

            for (const [noteId, noteData] of Object.entries(centralManifest.notes)) {
                if (!noteData || typeof noteData.notePath !== 'string') {
                    console.warn(`VC: Corrupted entry in central manifest for ID ${noteId}. Removing. Data:`, JSON.stringify(noteData));
                    orphanedNoteIdsToDelete.push(noteId);
                    continue;
                }

                const noteFileExists = allVaultFilePaths.has(noteData.notePath);

                if (!noteFileExists) {
                    console.log(`VC (Orphan): File not found for note ID ${noteId} at path "${noteData.notePath}". Scheduling data deletion.`);
                    orphanedNoteIdsToDelete.push(noteId);
                } else {
                    const file = this.app.vault.getAbstractFileByPath(noteData.notePath) as TFile;
                    const fileCache = this.app.metadataCache.getFileCache(file);
                    let idFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
                    if (typeof idFromFrontmatter === 'string' && idFromFrontmatter.trim() === '') {
                        idFromFrontmatter = null;
                    }

                    if (idFromFrontmatter !== noteId) {
                        console.log(`VC (Orphan): Mismatched vc-id for note ID ${noteId} at path "${noteData.notePath}". Manifest ID: ${noteId}, File FM ID: "${idFromFrontmatter}". Scheduling data deletion.`);
                        orphanedNoteIdsToDelete.push(noteId);
                    }
                }
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
