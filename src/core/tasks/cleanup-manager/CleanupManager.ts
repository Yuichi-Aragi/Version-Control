import { App, Component } from 'obsidian';
import { ManifestManager, EditHistoryManager } from '@/core';
import { PluginEvents } from '@/core';
import { PathService } from '@/core';
import { QueueService } from '@/services';
import { VersionContentRepository } from '@/core';
import type VersionControlPlugin from '@/main';
import type { StorageService } from '@/core';
import type { AppStore } from '@/state';
import type { CleanupResult } from './types';
import { ORPHAN_CLEANUP_QUEUE_KEY, QUEUE_PREFIX, CLEANUP_INTERVAL_MS } from './config';
import { DebouncerManager } from './scheduling';
import { PolicyCleanupOperation, OrphanCleanupOperation } from './operations';

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * 
 * FEATURES:
 * - Event-driven cleanup (on save) via Debouncer.
 * - Periodic background cleanup (interval).
 * - Context-aware: Cleans up the active note's branches based on their specific settings.
 * - Mode-aware: Handles Version History and Edit History independently.
 * - Concurrency control: Uses QueueService to prevent deadlocks and race conditions.
 */
export class CleanupManager extends Component {
  private readonly cleanupPromises = new Map<string, Promise<void>>();
  private readonly operationLocks = new Map<string, Promise<void>>();
  private readonly debouncerManager: DebouncerManager;
  private readonly policyCleanupOp: PolicyCleanupOperation;
  private readonly orphanCleanupOp: OrphanCleanupOperation;
  
  private periodicCleanupTimer: number | null = null;
  private isDestroyed = false;

  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly editHistoryManager: EditHistoryManager,
    private readonly eventBus: PluginEvents,
    private readonly pathService: PathService,
    private readonly queueService: QueueService,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly plugin: VersionControlPlugin,
    private readonly storageService: StorageService,
    private readonly store: AppStore
  ) {
    super();
    this.debouncerManager = new DebouncerManager();
    this.policyCleanupOp = new PolicyCleanupOperation(
      this.manifestManager,
      this.editHistoryManager,
      this.versionContentRepo,
      this.eventBus,
      this.plugin
    );
    this.orphanCleanupOp = new OrphanCleanupOperation(
      this.app,
      this.manifestManager,
      this.editHistoryManager,
      this.pathService,
      this.storageService,
      this.eventBus,
      this.plugin
    );
  }

  public initialize(): void {
    this.validateDependencies();

    // Event Listeners
    this.eventBus.on('version-saved', this.handleVersionSaved);
    this.register(() => this.eventBus.off('version-saved', this.handleVersionSaved));

    this.eventBus.on('history-deleted', this.handleHistoryDeleted);
    this.register(() => this.eventBus.off('history-deleted', this.handleHistoryDeleted));

    // Start Periodic Background Cleanup
    this.startPeriodicCleanup();

    // Cleanup on destroy
    this.register(() => {
      this.isDestroyed = true;
      this.stopPeriodicCleanup();
      this.debouncerManager.destroy();
      this.cleanupPromises.clear();
      this.operationLocks.clear();
    });
  }

  private validateDependencies(): void {
    if (!this.app?.vault) throw new Error('App instance with vault is required');
    if (!this.manifestManager) throw new Error('ManifestManager is required');
    if (!this.editHistoryManager) throw new Error('EditHistoryManager is required');
    if (!this.eventBus) throw new Error('EventBus is required');
    if (!this.pathService) throw new Error('PathService is required');
    if (!this.queueService) throw new Error('QueueService is required');
    if (!this.versionContentRepo) throw new Error('VersionContentRepository is required');
    if (!this.plugin) throw new Error('Plugin instance is required');
    if (!this.storageService) throw new Error('StorageService is required');
    if (!this.store) throw new Error('Store is required');
  }

  private getQueueKey(noteId: string): string {
    return `${QUEUE_PREFIX}${noteId}`;
  }

  // --- Periodic Cleanup Logic ---

  private startPeriodicCleanup(): void {
    if (this.periodicCleanupTimer !== null) return;
    
    // Run initial check after a short delay to allow app to settle
    window.setTimeout(() => this.performPeriodicCheck(), 10000);

    this.periodicCleanupTimer = window.setInterval(() => {
      this.performPeriodicCheck();
    }, CLEANUP_INTERVAL_MS);
  }

  private stopPeriodicCleanup(): void {
    if (this.periodicCleanupTimer !== null) {
      window.clearInterval(this.periodicCleanupTimer);
      this.periodicCleanupTimer = null;
    }
  }

  /**
   * Performs a periodic cleanup check for the currently active note.
   * This ensures that even if no manual save happens, old versions are cleaned up
   * according to age policies (e.g. autoCleanupOldVersions).
   */
  private performPeriodicCheck(): void {
    if (this.isDestroyed) return;

    const state = this.store.getState();
    const activeNoteId = state.app.noteId;

    if (activeNoteId && this.isValidNoteId(activeNoteId)) {
      // We schedule cleanup for the active note.
      // This will check both Version History and Edit History policies.
      this.scheduleCleanup(activeNoteId);
    }
  }

  // --- Event Handlers ---

  private handleVersionSaved = (noteId: string): void => {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    const debouncer = this.debouncerManager.createDebouncer(noteId, () => {
      if (!this.isDestroyed) {
        this.scheduleCleanup(noteId);
      }
    });
    debouncer();
  };

  private handleHistoryDeleted = (noteId: string): void => {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    this.debouncerManager.removeDebouncer(noteId);

    const cleanupPromise = this.cleanupPromises.get(noteId);
    if (cleanupPromise) {
      cleanupPromise.catch(() => {});
      this.cleanupPromises.delete(noteId);
    }
  };

  private isValidNoteId(noteId: string): boolean {
    return typeof noteId === 'string' && noteId.length > 0 && !noteId.includes('..');
  }

  // --- Scheduling Logic ---

  public scheduleCleanup(noteId: string): void {
    if (!this.isValidNoteId(noteId) || this.isDestroyed) {
      return;
    }

    // If a cleanup is already pending/running for this note, don't queue another one immediately.
    if (this.cleanupPromises.has(noteId)) {
      return;
    }

    // Enqueue the cleanup task. 
    // This uses the QueueService to ensure it doesn't conflict with active saves.
    const cleanupPromise = this.queueService.enqueue(this.getQueueKey(noteId), () => this.performPerNoteCleanup(noteId))
      .catch((err) => {
        console.error(`VC: Error during scheduled cleanup for note ${noteId}.`, err);
        throw err;
      })
      .finally(() => {
        this.cleanupPromises.delete(noteId);
      });

    this.cleanupPromises.set(noteId, cleanupPromise);
  }

  /**
   * Executes the cleanup policy for a specific note.
   * Runs sequentially for Version History then Edit History.
   */
  private async performPerNoteCleanup(noteId: string): Promise<void> {
    if (this.isDestroyed) return;

    // Use a local lock to prevent concurrent execution of the *logic* for the same note
    // even if QueueService allows entry (though QueueService key usually handles this).
    const existingLock = this.operationLocks.get(noteId);
    if (existingLock) {
      await existingLock;
      return;
    }

    const cleanupLock = (async () => {
      try {
        // Clean Version History
        await this.policyCleanupOp.cleanup(noteId, 'version');
        
        // Clean Edit History
        await this.policyCleanupOp.cleanup(noteId, 'edit');
      } finally {
        this.operationLocks.delete(noteId);
      }
    })();

    this.operationLocks.set(noteId, cleanupLock);
    await cleanupLock;
  }

  // --- Orphan Cleanup (Global) ---

  public cleanupOrphanedVersions(): Promise<CleanupResult> {
    return this.queueService.enqueue(ORPHAN_CLEANUP_QUEUE_KEY, async () => {
      if (this.isDestroyed) {
        return { 
          deletedNoteDirs: 0, 
          deletedVersionFiles: 0, 
          deletedDuplicates: 0,
          deletedOrphans: 0,
          recoveredNotes: 0,
          success: false 
        };
      }

      const result: CleanupResult = {
        deletedNoteDirs: 0,
        deletedVersionFiles: 0,
        deletedDuplicates: 0,
        deletedOrphans: 0,
        recoveredNotes: 0,
        success: true,
        errors: []
      };

      try {
        await this.orphanCleanupOp.performDeepCleanup(result, () => this.isDestroyed);
      } catch (e) {
        result.success = false;
        const error = e instanceof Error ? e.message : String(e);
        result.errors?.push(error);
        console.error('VC: Unexpected error during orphan data cleanup.', e);
      }

      return result;
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
