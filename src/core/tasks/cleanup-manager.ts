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
import type { NoteManifest as CoreNoteManifest, CentralManifest as CoreCentralManifest } from '../../types';

const ORPHAN_CLEANUP_QUEUE_KEY = 'system:orphan-cleanup';
const CLEANUP_DEBOUNCE_INTERVAL_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

interface CleanupResult {
  deletedNoteDirs: number;
  deletedVersionFiles: number;
  success: boolean;
  errors?: string[];
}

type NoteManifest = CoreNoteManifest;
type CentralManifest = CoreCentralManifest;

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 * Extends Component to leverage automatic event listener cleanup.
 */
@injectable()
export class CleanupManager extends Component {
  private readonly cleanupPromises = new Map<string, Promise<void>>();
  private readonly debouncedCleanups = new Map<string, Debouncer<[], void>>();
  private readonly operationLocks = new Map<string, Promise<void>>();
  private isDestroyed = false;

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
    this.validateDependencies();
    
    this.eventBus.on('version-saved', this.handleVersionSaved);
    this.register(() => this.eventBus.off('version-saved', this.handleVersionSaved));

    this.eventBus.on('history-deleted', this.handleHistoryDeleted);
    this.register(() => this.eventBus.off('history-deleted', this.handleHistoryDeleted));

    this.register(() => {
      this.isDestroyed = true;
      this.debouncedCleanups.forEach(d => d.cancel());
      this.debouncedCleanups.clear();
      this.cleanupPromises.clear();
      this.operationLocks.clear();
    });
  }

  private validateDependencies(): void {
    if (!this.app?.vault) {
      throw new Error('App instance with vault is required');
    }
    if (!this.manifestManager) {
      throw new Error('ManifestManager is required');
    }
    if (!this.eventBus) {
      throw new Error('EventBus is required');
    }
    if (!this.pathService) {
      throw new Error('PathService is required');
    }
    if (!this.queueService) {
      throw new Error('QueueService is required');
    }
    if (!this.versionContentRepo) {
      throw new Error('VersionContentRepository is required');
    }
    if (!this.plugin) {
      throw new Error('Plugin instance is required');
    }
    if (!this.storageService) {
      throw new Error('StorageService is required');
    }
  }

  private handleVersionSaved = (noteId: string): void => {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    let debouncer = this.debouncedCleanups.get(noteId);
    if (!debouncer) {
      debouncer = debounce(() => {
        if (!this.isDestroyed) {
          this.scheduleCleanup(noteId);
        }
      }, CLEANUP_DEBOUNCE_INTERVAL_MS, false);
      this.debouncedCleanups.set(noteId, debouncer);
    }
    debouncer();
  };

  private handleHistoryDeleted = (noteId: string): void => {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    const debouncer = this.debouncedCleanups.get(noteId);
    if (debouncer) {
      debouncer.cancel();
      this.debouncedCleanups.delete(noteId);
    }

    const cleanupPromise = this.cleanupPromises.get(noteId);
    if (cleanupPromise) {
      cleanupPromise.catch(() => {});
      this.cleanupPromises.delete(noteId);
    }
  };

  private isValidNoteId(noteId: string): boolean {
    return typeof noteId === 'string' && noteId.length > 0 && !noteId.includes('..');
  }

  public scheduleCleanup(noteId: string): void {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    if (this.cleanupPromises.has(noteId)) {
      return;
    }

    const cleanupPromise = this.queueService.enqueue(noteId, () => this.performPerNoteCleanup(noteId))
      .catch((err) => {
        console.error(`VC: Error during scheduled cleanup for note ${noteId}.`, err);
        throw err;
      })
      .finally(() => {
        this.cleanupPromises.delete(noteId);
      });

    this.cleanupPromises.set(noteId, cleanupPromise);
  }

  private async performPerNoteCleanup(noteId: string): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    const existingLock = this.operationLocks.get(noteId);
    if (existingLock) {
      await existingLock;
      return;
    }

    const cleanupLock = (async () => {
      try {
        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) return;

        const currentBranch = noteManifest.branches[noteManifest.currentBranch];
        if (!currentBranch?.versions) return;

        const globalSettings = this.plugin.settings || {};
        const effectiveSettings = { ...globalSettings, ...(currentBranch.settings || {}) };

        const {
          maxVersionsPerNote = 0,
          autoCleanupOldVersions = false,
          autoCleanupDays = 0
        } = effectiveSettings;

        const isMaxVersionsCleanupEnabled = maxVersionsPerNote > 0;
        const isAgeCleanupEnabled = autoCleanupOldVersions && autoCleanupDays > 0;

        if (!isMaxVersionsCleanupEnabled && !isAgeCleanupEnabled) return;

        const versions = orderBy(
          Object.entries(currentBranch.versions),
          ([, v]) => v.versionNumber,
          ['desc']
        );

        if (versions.length <= 1) return;

        if (typeof (moment as any) !== 'function') {
            console.error("VC: moment.js is not available. Cannot perform age-based cleanup.");
            return;
        }

        const versionsToDelete = new Set<string>();
        const cutoffDate = (moment as any)().subtract(autoCleanupDays, 'days');

        versions.forEach(([id, versionData], index) => {
          if (isMaxVersionsCleanupEnabled && index >= maxVersionsPerNote) {
            versionsToDelete.add(id);
          }
          if (isAgeCleanupEnabled && (moment as any)(versionData.timestamp).isBefore(cutoffDate)) {
            versionsToDelete.add(id);
          }
        });

        if (versionsToDelete.size === versions.length) {
          const newestVersionId = versions[0]?.[0];
          if (newestVersionId) {
            versionsToDelete.delete(newestVersionId);
          }
        }

        if (versionsToDelete.size === 0) return;

        await this.deleteVersions(noteId, noteManifest.currentBranch, versionsToDelete);
        this.eventBus.trigger('version-deleted', noteId);
      } finally {
        this.operationLocks.delete(noteId);
      }
    })();

    this.operationLocks.set(noteId, cleanupLock);
    await cleanupLock;
  }

  private async deleteVersions(noteId: string, branchName: string, versionIds: Set<string>): Promise<void> {
    const updateManifestPromise = this.manifestManager.updateNoteManifest(
      noteId,
      (manifest: NoteManifest) => {
        const branch = manifest.branches[branchName];
        if (branch) {
            for (const id of versionIds) {
                if (branch.versions[id]) {
                    delete branch.versions[id];
                }
            }
        }
        manifest.lastModified = new Date().toISOString();
      },
      { bypassQueue: true }
    );

    const deleteFilesPromises = [...versionIds].map((id) =>
      this.versionContentRepo
        .delete(noteId, id, { bypassQueue: true })
        .catch((e) => console.error(`VC: Failed to delete version file for id ${id}`, e))
    );

    await Promise.all([updateManifestPromise, ...deleteFilesPromises]);
  }

  public cleanupOrphanedVersions(): Promise<CleanupResult> {
    return this.queueService.enqueue(ORPHAN_CLEANUP_QUEUE_KEY, async () => {
      if (this.isDestroyed) {
        return { deletedNoteDirs: 0, deletedVersionFiles: 0, success: false };
      }

      const result: CleanupResult = {
        deletedNoteDirs: 0,
        deletedVersionFiles: 0,
        success: true,
        errors: []
      };

      try {
        await this.cleanupOrphanedNoteHistories(result);
        await this.cleanupOrphanedVersionFiles(result);
      } catch (e) {
        result.success = false;
        const error = e instanceof Error ? e.message : String(e);
        result.errors?.push(error);
        console.error('VC: Unexpected error during orphan data cleanup.', e);
      }

      return result;
    });
  }

  private async cleanupOrphanedNoteHistories(result: CleanupResult): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys((centralManifest as CentralManifest)?.notes || {}));
    
    const dbRootPath = this.pathService.getDbRoot();
    const dbRootFolder = this.app.vault.getAbstractFileByPath(dbRootPath);

    if (!(dbRootFolder instanceof TFolder)) {
      return;
    }

    const childrenCopy = [...dbRootFolder.children];
    for (const noteDir of childrenCopy) {
      if (!(noteDir instanceof TFolder) || this.isDestroyed) {
        continue;
      }

      const noteId = noteDir.name;
      if (this.isValidNoteId(noteId) && !validNoteIds.has(noteId)) {
        await this.retryOperation(
          () => this.storageService.permanentlyDeleteFolder(noteDir.path),
          `Failed to delete orphaned note directory: ${noteDir.path}`
        );
        result.deletedNoteDirs++;
      }
    }
  }

  private async cleanupOrphanedVersionFiles(result: CleanupResult): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys((centralManifest as CentralManifest)?.notes || {}));

    for (const noteId of validNoteIds) {
      if (this.isDestroyed) {
        break;
      }

      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      if (!noteManifest) {
        console.warn(`VC: Note ID ${noteId} is in central manifest but its own manifest is missing.`);
        continue;
      }

      const allValidVersionIds = new Set<string>();
      for (const branchName in noteManifest.branches) {
          const branch = noteManifest.branches[branchName];
          if (branch?.versions) {
              Object.keys(branch.versions).forEach(id => allValidVersionIds.add(id));
          }
      }

      const versionsPath = this.pathService.getNoteVersionsPath(noteId);
      const versionsFolder = this.app.vault.getAbstractFileByPath(versionsPath);

      if (!(versionsFolder instanceof TFolder)) {
        continue;
      }

      const childrenCopy = [...versionsFolder.children];
      for (const versionFile of childrenCopy) {
        if (!(versionFile instanceof TFile) || this.isDestroyed) {
          continue;
        }

        const fileName = versionFile.name;
        if (fileName?.endsWith('.md')) {
          const versionId = fileName.slice(0, -3);
          if (versionId && !allValidVersionIds.has(versionId)) {
            await this.retryOperation(
              () => this.app.vault.adapter.remove(versionFile.path),
              `Failed to delete orphaned version file: ${versionFile.path}`
            );
            result.deletedVersionFiles++;
          }
        }
      }
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    attempts: number = MAX_RETRY_ATTEMPTS
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    console.error(`VC: ${errorMessage} after ${attempts} attempts.`, lastError);
    throw lastError || new Error(errorMessage);
  }

  public async completePendingCleanups(): Promise<void> {
    const pending = [...this.cleanupPromises.values()];
    if (pending.length) {
      await Promise.allSettled(pending);
    }
    this.cleanupPromises.clear();
  }
}
