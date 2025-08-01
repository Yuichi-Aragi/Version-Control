import { App, moment, Component, TFolder, TFile } from 'obsidian';
import { orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { ManifestManager } from './manifest-manager';
import { PluginEvents } from './plugin-events';
import { PathService } from './storage/path-service';
import { TYPES } from '../types/inversify.types';
import type { AppStore } from '../state/store';
import { QueueService } from '../services/queue-service';
import { VersionContentRepository } from './storage/version-content-repository';

const ORPHAN_CLEANUP_QUEUE_KEY = 'system:orphan-cleanup';

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 * Extends Component to leverage automatic event listener cleanup.
 */
@injectable()
export class CleanupManager extends Component {
  private cleanupPromises = new Map<string, Promise<void>>();

  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.ManifestManager) private readonly manifestManager: ManifestManager,
    @inject(TYPES.Store) private readonly store: AppStore,
    @inject(TYPES.EventBus) private readonly eventBus: PluginEvents,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService,
    @inject(TYPES.VersionContentRepo) private readonly versionContentRepo: VersionContentRepository
  ) {
    super();
  }

  public initialize(): void {
    this.eventBus.on('version-saved', this.handleVersionSaved);
    this.register(() => this.eventBus.off('version-saved', this.handleVersionSaved));
  }

  private handleVersionSaved = (noteId: string): void => {
    this.scheduleCleanup(noteId);
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
    const s = this.store.getState().settings;
    const { maxVersionsPerNote, autoCleanupOldVersions, autoCleanupDays } = s;

    if (maxVersionsPerNote <= 0 && (!autoCleanupOldVersions || autoCleanupDays <= 0)) {
      return;
    }

    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest?.versions || Object.keys(noteManifest.versions).length <= 1) {
      return;
    }

    const versions = orderBy(Object.entries(noteManifest.versions), ([, v]) => new Date(v.timestamp).getTime(), ['desc']);

    if (versions.length <= 1) {
      return;
    }

    const keep = new Set<string>();
    const del = new Set<string>();
    const cutoff = moment().subtract(autoCleanupDays, 'days');

    for (const [id, v] of versions) {
      const byCount = maxVersionsPerNote <= 0 || keep.size < maxVersionsPerNote;
      const byAge = !autoCleanupOldVersions || autoCleanupDays <= 0 || moment(v.timestamp).isSameOrAfter(cutoff);
      (byCount && byAge ? keep : del).add(id);
    }

    if (keep.size === 0 && versions.length > 0) {
      const newestVersionId = versions[0]![0];
      del.delete(newestVersionId);
    }

    if (del.size === 0) {
      return;
    }

    // Update manifest
    // FIX: Corrected immer usage. The recipe should mutate the draft and return void, not the draft itself.
    await this.manifestManager.updateNoteManifest(noteId, (m) => {
      for (const id of del) {
        delete m.versions[id];
      }
      m.lastModified = new Date().toISOString();
    });

    // Delete files using the now-queued repository method.
    const deletions = [...del].map((id) =>
      this.versionContentRepo
        .delete(noteId, id)
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
                        await this.permanentlyDeleteFolder(noteDir.path);
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

  /**
   * Permanently and recursively deletes a folder using the vault adapter.
   * This is for internal use on the `.versiondb` directory and bypasses trash settings.
   * @param path The path of the folder to delete.
   */
  private async permanentlyDeleteFolder(path: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
        if (await adapter.exists(path)) {
            // The `true` flag enables recursive deletion. This is a permanent operation.
            await adapter.rmdir(path, true);
        }
    } catch (error) {
        console.error(`VC: CRITICAL: Failed to permanently delete folder ${path}. Manual cleanup may be needed.`, error);
    }
  }
}
