import { App, moment, Component, TFolder, TFile, debounce, type Debouncer } from 'obsidian';
import { orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { ManifestManager } from '../manifest-manager';
import { PluginEvents } from '../plugin-events';
import { PathService } from '../storage/path-service';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import { VersionContentRepository } from '../storage/version-content-repository';
import type VersionControlPlugin from '../../main';
import type { StorageService } from '../storage/storage-service';

const ORPHAN_CLEANUP_QUEUE_KEY = 'system:orphan-cleanup';
const CLEANUP_DEBOUNCE_INTERVAL_MS = 5000;

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 * Extends Component to leverage automatic event listener cleanup.
 */
@injectable()
export class CleanupManager extends Component {
  private cleanupPromises = new Map<string, Promise<void>>();
  private debouncedCleanups = new Map<string, Debouncer<[], void>>();

  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.ManifestManager) private readonly manifestManager: ManifestManager,
    @inject(TYPES.EventBus) private readonly eventBus: PluginEvents,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService,
    @inject(TYPES.VersionContentRepo) private readonly versionContentRepo: VersionContentRepository,
    @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
    @inject(TYPES.StorageService) private readonly storageService: StorageService
  ) {
    super();
  }

  public initialize(): void {
    this.eventBus.on('version-saved', this.handleVersionSaved);
    this.register(() => this.eventBus.off('version-saved', this.handleVersionSaved));

    this.eventBus.on('history-deleted', this.handleHistoryDeleted);
    this.register(() => this.eventBus.off('history-deleted', this.handleHistoryDeleted));

    // On unload, cancel any pending debounced calls to prevent them from firing after cleanup.
    this.register(() => {
        this.debouncedCleanups.forEach(d => d.cancel());
        this.debouncedCleanups.clear();
    });
  }

  private handleVersionSaved = (noteId: string): void => {
    let debouncer = this.debouncedCleanups.get(noteId);
    if (!debouncer) {
        // Create a new trailing-edge debouncer for this note.
        // It will only call `scheduleCleanup` after the save events have stopped
        // for the specified interval.
        debouncer = debounce(() => {
            this.scheduleCleanup(noteId);
        }, CLEANUP_DEBOUNCE_INTERVAL_MS, false); // `false` for trailing-edge execution
        this.debouncedCleanups.set(noteId, debouncer);
    }
    // Trigger the debouncer on every save.
    debouncer();
  };

  /**
   * When a note's history is deleted, we must clean up its associated debouncer
   * to prevent memory leaks.
   * @param noteId The ID of the note whose history was deleted.
   */
  private handleHistoryDeleted = (noteId: string): void => {
    const debouncer = this.debouncedCleanups.get(noteId);
    if (debouncer) {
        debouncer.cancel();
        this.debouncedCleanups.delete(noteId);
    }
  };

  public scheduleCleanup(noteId: string): void {
    // If a cleanup promise for this note already exists, it means a cleanup
    // is already queued or running. We don't need to schedule another.
    if (this.cleanupPromises.has(noteId)) {
      return;
    }

    // Enqueue the cleanup task. This ensures it runs sequentially with any other
    // operations (like saving) for the same note.
    const cleanupPromise = this.queueService.enqueue(noteId, () => this.performPerNoteCleanup(noteId))
      .catch((err) => {
        console.error(`VC: Error during scheduled cleanup for note ${noteId}.`, err);
      })
      .finally(() => {
        // Once the promise completes (success or fail), remove it from the tracking map.
        this.cleanupPromises.delete(noteId);
      });

    // Store the promise so we can await it during plugin unload.
    this.cleanupPromises.set(noteId, cleanupPromise);
  }

  private async performPerNoteCleanup(noteId: string): Promise<void> {
    // 1. Load the manifest for the specific note being cleaned up. This makes the
    // operation self-contained and independent of the UI state.
    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest?.versions) {
      return; // No manifest or no versions, nothing to clean.
    }

    // 2. Determine the effective settings for THIS note by merging global settings
    // with any per-note overrides from its manifest.
    const globalSettings = this.plugin.settings;
    const effectiveSettings = { ...globalSettings, ...(noteManifest.settings || {}) };

    const { maxVersionsPerNote, autoCleanupOldVersions, autoCleanupDays } = effectiveSettings;

    const isMaxVersionsCleanupEnabled = maxVersionsPerNote > 0;
    const isAgeCleanupEnabled = autoCleanupOldVersions && autoCleanupDays > 0;

    // 3. Entry Guard: Return if no cleanup rules are active for this specific note.
    if (!isMaxVersionsCleanupEnabled && !isAgeCleanupEnabled) {
      return;
    }

    // Sort by version number descending (newest first). This is the canonical order.
    const versions = orderBy(Object.entries(noteManifest.versions), ([, v]) => v.versionNumber, ['desc']);

    // Don't clean up if there's only one version.
    if (versions.length <= 1) {
      return;
    }

    const versionsToDelete = new Set<string>();
    const cutoffDate = (moment as any)().subtract(autoCleanupDays, 'days');

    // 4. Identify versions to delete based on the note's effective settings.
    versions.forEach(([id, versionData], index) => {
      // Rule 1: Max version count exceeded.
      if (isMaxVersionsCleanupEnabled && index >= maxVersionsPerNote) {
        versionsToDelete.add(id);
      }

      // Rule 2: Version is too old.
      if (isAgeCleanupEnabled && (moment as any)(versionData.timestamp).isBefore(cutoffDate)) {
        versionsToDelete.add(id);
      }
    });

    // 5. Safeguard: Never delete the last remaining version.
    if (versionsToDelete.size === versions.length) {
      const newestVersionId = versions[0]?.[0];
      if (newestVersionId) {
          versionsToDelete.delete(newestVersionId);
      }
    }

    if (versionsToDelete.size === 0) {
      return;
    }

    // 6. Execute Deletion. These operations MUST bypass the queue to prevent a deadlock,
    // as this entire function is already running inside the queue's serialization context.
    await this.manifestManager.updateNoteManifest(noteId, (m) => {
      for (const id of versionsToDelete) {
        if (m.versions[id]) {
            delete m.versions[id];
        }
      }
      m.lastModified = new Date().toISOString();
    }, { bypassQueue: true });

    // Delete the corresponding version content files.
    const deletions = [...versionsToDelete].map((id) =>
      this.versionContentRepo
        .delete(noteId, id, { bypassQueue: true })
        .catch((e) => console.error(`VC: Failed to delete version file for id ${id}`, e))
    );

    await Promise.allSettled(deletions);
    this.eventBus.trigger('version-deleted', noteId);
  }

  /**
   * Cleans up orphaned data within the `.versiondb` directory. This is a data
   * integrity check and does not interact with live notes in the vault.
   * It performs two main tasks:
   * 1. Deletes any note-specific data directories (`.versiondb/[noteId]`)
   *    that are not listed in the central manifest.
   * 2. For each valid note, it deletes any version files (`.../versions/[versionId].md`)
   *    that are not listed in that note's individual manifest.
   * @returns A promise that resolves with the counts of deleted items and a success flag.
   */
  public cleanupOrphanedVersions(): Promise<{ deletedNoteDirs: number; deletedVersionFiles: number; success: boolean }> {
    // The operation is now queued using a dedicated key to ensure that all
    // user requests are processed sequentially and reliably, preventing dropped
    // commands and race conditions. The re-entrant check flag is no longer needed.
    return this.queueService.enqueue(ORPHAN_CLEANUP_QUEUE_KEY, async () => {
        let deletedNoteDirs = 0;
        let deletedVersionFiles = 0;

        try {
            // --- Task 1: Cleanup Orphaned Note Histories ---
            const centralManifest = await this.manifestManager.loadCentralManifest(true);
            const validNoteIds = new Set(Object.keys(centralManifest.notes));
            
            // The root folder where all note-specific data directories are stored.
            const dbRootPath = this.pathService.getDbRoot();

            const dbRootFolder = this.app.vault.getAbstractFileByPath(dbRootPath);
            if (dbRootFolder instanceof TFolder) {
                // We iterate over a copy of children because the collection might be modified during iteration.
                const childrenCopy = [...dbRootFolder.children];
                for (const noteDir of childrenCopy) {
                    if (!(noteDir instanceof TFolder)) continue;

                    const noteId = noteDir.name;
                    if (noteId && !validNoteIds.has(noteId)) {
                        // Permanently delete the orphaned note directory.
                        await this.storageService.permanentlyDeleteFolder(noteDir.path);
                        deletedNoteDirs++;
                    }
                }
            }

            // --- Task 2: Cleanup Orphaned Version Files ---
            for (const noteId of validNoteIds) {
                const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
                if (!noteManifest) {
                    console.warn(`VC: Note ID ${noteId} is in central manifest but its own manifest is missing. Skipping version cleanup for it.`);
                    continue;
                }

                const validVersionIds = new Set(Object.keys(noteManifest.versions || {}));
                const versionsPath = this.pathService.getNoteVersionsPath(noteId);

                const versionsFolder = this.app.vault.getAbstractFileByPath(versionsPath);
                if (versionsFolder instanceof TFolder) {
                    // Iterate over a copy of children.
                    const childrenCopy = [...versionsFolder.children];
                    for (const versionFile of childrenCopy) {
                        if (!(versionFile instanceof TFile)) continue;
                        
                        const fileName = versionFile.name;
                        if (fileName && fileName.endsWith('.md')) {
                            const versionId = fileName.slice(0, -3); // remove .md
                            if (!validVersionIds.has(versionId)) {
                                // Permanently delete the orphaned version file.
                                await this.app.vault.adapter.remove(versionFile.path);
                                deletedVersionFiles++;
                            }
                        }
                    }
                }
            }

            return { deletedNoteDirs, deletedVersionFiles, success: true };
        } catch (e) {
            console.error('VC: Unexpected error during orphan data cleanup.', e);
            return { deletedNoteDirs: 0, deletedVersionFiles: 0, success: false };
        }
    });
  }

  public async completePendingCleanups(): Promise<void> {
    const pending = [...this.cleanupPromises.values()];
    if (pending.length) {
      await Promise.allSettled(pending);
    }
    this.cleanupPromises.clear();
  }
}
