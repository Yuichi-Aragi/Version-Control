import { App, Notice, moment } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { VersionControlSettings, NoteManifest } from "../types";

export class CleanupManager {
    private app: App;
    private manifestManager: ManifestManager;
    private settingsProvider: () => VersionControlSettings;
    private cleanupPromises = new Map<string, Promise<void>>();
    private periodicCleanupInterval: number | null = null;

    constructor(app: App, manifestManager: ManifestManager, settingsProvider: () => VersionControlSettings) {
        this.app = app;
        this.manifestManager = manifestManager;
        this.settingsProvider = settingsProvider;
    }

    /**
     * Schedules cleanup for a specific note to avoid concurrent operations.
     */
    scheduleCleanup(noteId: string): void {
        if (this.cleanupPromises.has(noteId)) {
            return; // Cleanup already scheduled
        }
        const cleanupPromise = this.cleanupOldVersions(noteId)
            .finally(() => {
                this.cleanupPromises.delete(noteId);
            });
        this.cleanupPromises.set(noteId, cleanupPromise);
    }

    /**
     * Cleans up old versions for a single note based on settings.
     */
    private async cleanupOldVersions(noteId: string): Promise<void> {
        try {
            const settings = this.settingsProvider();
            const { maxVersionsPerNote, autoCleanupOldVersions, autoCleanupDays } = settings;

            if ((maxVersionsPerNote <= 0 || maxVersionsPerNote === Infinity) && !autoCleanupOldVersions) {
                return;
            }

            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || Object.keys(noteManifest.versions).length <= 1) {
                return;
            }

            const versions = Object.entries(noteManifest.versions);
            const versionsToDelete = new Set<string>();

            // Age-based cleanup
            if (autoCleanupOldVersions && autoCleanupDays > 0) {
                const cutoffDate = moment().subtract(autoCleanupDays, 'days');
                for (const [versionId, versionData] of versions) {
                    if (versions.length - versionsToDelete.size <= 1) break;
                    if (moment(versionData.timestamp).isBefore(cutoffDate)) {
                        versionsToDelete.add(versionId);
                    }
                }
            }

            // Count-based cleanup
            if (maxVersionsPerNote > 0) {
                const remainingVersions = versions.filter(([versionId]) => !versionsToDelete.has(versionId));
                if (remainingVersions.length > maxVersionsPerNote) {
                    remainingVersions.sort(([, a], [, b]) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    const numberToDelete = remainingVersions.length - maxVersionsPerNote;
                    for (let i = 0; i < numberToDelete; i++) {
                        versionsToDelete.add(remainingVersions[i][0]);
                    }
                }
            }

            if (versionsToDelete.size > 0) {
                await this.deleteVersions(noteManifest, versionsToDelete);
            }
        } catch (error) {
            console.error(`Version Control: Error during old version cleanup for note ${noteId}`, error);
        }
    }

    /**
     * Deletes multiple version files and updates the note manifest.
     */
    private async deleteVersions(noteManifest: NoteManifest, versionIds: Set<string>): Promise<void> {
        let deletedCount = 0;
        const deletionPromises: Promise<void>[] = [];
        const failedDeletions: string[] = [];

        for (const versionId of versionIds) {
            if (noteManifest.versions[versionId]) {
                const versionPath = noteManifest.versions[versionId].filePath;
                delete noteManifest.versions[versionId];
                
                deletionPromises.push(
                    this.app.vault.adapter.exists(versionPath)
                        .then(exists => exists ? this.app.vault.adapter.remove(versionPath) : Promise.resolve())
                        .catch(error => {
                            failedDeletions.push(versionPath);
                            console.error(`Failed to delete version file ${versionPath}:`, error);
                        })
                );
                deletedCount++;
            }
        }

        await Promise.allSettled(deletionPromises);

        if (failedDeletions.length > 0) {
            console.error(`Version Control: Failed to delete ${failedDeletions.length} version files.`, failedDeletions);
            new Notice("Version Control: Some old version files could not be deleted. Check console.");
        }

        if (deletedCount > 0) {
            noteManifest.lastModified = new Date().toISOString();
            await this.manifestManager.saveNoteManifest(noteManifest);
            console.log(`Version Control: Cleaned up ${deletedCount} old versions for note ${noteManifest.noteId}.`);
        }
    }

    /**
     * Scans the vault for version data linked to notes that no longer exist.
     */
    async cleanupOrphanedVersions(manualTrigger: boolean) {
        try {
            const settings = this.settingsProvider();
            if (!settings.autoCleanupOrphanedVersions && !manualTrigger) {
                return;
            }

            if (manualTrigger) {
                new Notice("Starting cleanup of orphaned version data...");
            }
            
            const centralManifest = await this.manifestManager.loadCentralManifest();
            if (!centralManifest) {
                if (manualTrigger) new Notice("Cleanup failed: Could not load manifest.");
                return;
            }

            const allNotePaths = new Set(this.app.vault.getMarkdownFiles().map(f => f.path));
            let orphanedCount = 0;
            const promises = [];

            for (const [noteId, data] of Object.entries(centralManifest.notes)) {
                // Defensive check for corrupted manifest entries
                if (!data || typeof data.notePath !== 'string') {
                    console.warn(`Version Control: Found corrupted entry in central manifest for ID ${noteId}. Deleting.`, data);
                    promises.push(this.manifestManager.deleteNoteEntry(noteId));
                    orphanedCount++;
                    continue;
                }

                if (!allNotePaths.has(data.notePath)) {
                    console.log(`Version Control: Found orphaned entry for ID ${noteId} (last known path: ${data.notePath}). Deleting.`);
                    promises.push(this.manifestManager.deleteNoteEntry(noteId));
                    orphanedCount++;
                }
            }

            if (promises.length > 0) {
                await Promise.all(promises);
            }

            if (manualTrigger) {
                if (orphanedCount > 0) {
                    new Notice(`Cleanup complete. Removed ${orphanedCount} orphaned version histor${orphanedCount > 1 ? 'ies' : 'y'}.`);
                } else {
                    new Notice("Cleanup complete. No orphaned version data found.");
                }
            } else if (orphanedCount > 0) {
                console.log(`Version Control: Auto-cleanup removed ${orphanedCount} orphaned version histories.`);
            }
        } catch (error) {
            console.error("Version Control: An unexpected error occurred during orphaned version cleanup.", error);
            if (manualTrigger) {
                new Notice("Orphaned version cleanup failed. Check console for details.");
            }
        }
    }

    /**
     * Sets up or tears down the periodic cleanup interval based on settings.
     * The initial startup cleanup is handled separately in the plugin's `onload` method.
     */
    public managePeriodicCleanup() {
        if (this.periodicCleanupInterval) {
            window.clearInterval(this.periodicCleanupInterval);
            this.periodicCleanupInterval = null;
        }
        if (this.settingsProvider().autoCleanupOrphanedVersions) {
            // Run every hour
            this.periodicCleanupInterval = window.setInterval(() => this.cleanupOrphanedVersions(false), 60 * 60 * 1000);
        }
    }

    /**
     * Clears any active intervals. This should be called on unload.
     */
    public cleanupIntervals(): void {
        if (this.periodicCleanupInterval) {
            window.clearInterval(this.periodicCleanupInterval);
            this.periodicCleanupInterval = null;
        }
    }

    /**
     * Waits for any pending cleanup operations to complete.
     */
    async completePendingCleanups(): Promise<void> {
        const pendingCleanups = Array.from(this.cleanupPromises.values());
        if (pendingCleanups.length > 0) {
            await Promise.allSettled(pendingCleanups);
        }
        this.cleanupPromises.clear();
    }
}