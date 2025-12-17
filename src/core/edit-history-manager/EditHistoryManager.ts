import { App } from 'obsidian';
import { injectable, inject } from 'inversify';
import PQueue from 'p-queue';
import { TYPES } from '@/types/inversify.types';
import type { NoteManifest, VersionHistoryEntry } from '@/types';
import type { PathService } from '@/core';
import { WorkerClient } from './infrastructure/worker-client';
import { PersistenceService } from './persistence/persistence-service';
import { AtomicOperationCoordinator } from './infrastructure/coordinator';
import { LockManager } from './infrastructure/lock-manager';
import { CreateOperation } from './operations/create-operation';
import { ReadOperation } from './operations/read-operation';
import { UpdateOperation } from './operations/update-operation';
import { DeleteOperation } from './operations/delete-operation';
import { OperationPriority, type EditHistoryStats } from './types';

const MAX_CONCURRENT_OPERATIONS = 4;

@injectable()
export class EditHistoryManager {
  private readonly workerClient: WorkerClient;
  private readonly persistence: PersistenceService;
  private readonly coordinator: AtomicOperationCoordinator;
  private readonly lockManager: LockManager;
  private readonly operationQueue: PQueue;

  private readonly createOp: CreateOperation;
  private readonly readOp: ReadOperation;
  private readonly updateOp: UpdateOperation;
  private readonly deleteOp: DeleteOperation;

  constructor(
    @inject(TYPES.App) app: App,
    @inject(TYPES.PathService) pathService: PathService
  ) {
    this.workerClient = new WorkerClient();
    this.persistence = new PersistenceService(app, pathService, this.workerClient);
    this.coordinator = new AtomicOperationCoordinator();
    this.lockManager = new LockManager();
    this.operationQueue = new PQueue({ concurrency: MAX_CONCURRENT_OPERATIONS });

    // Initialize Operations
    this.readOp = new ReadOperation(this.workerClient);
    
    this.deleteOp = new DeleteOperation(
      app,
      pathService,
      this.workerClient,
      this.persistence,
      this.coordinator,
      this.lockManager,
      this.readOp
    );

    this.createOp = new CreateOperation(
      this.workerClient,
      this.persistence,
      this.coordinator,
      this.lockManager,
      this.readOp,
      this.deleteOp
    );

    this.updateOp = new UpdateOperation(
      this.workerClient,
      this.persistence,
      this.lockManager,
      this.readOp
    );
  }

  public initialize(): void {
    this.workerClient.initialize();
  }

  public async terminate(): Promise<void> {
    this.persistence.shutdown();
    this.operationQueue.clear();
    this.coordinator.abortAtomicOperation('*', '*');
    this.workerClient.terminate();
  }

  public getStats(): EditHistoryStats {
    return {
      pendingWrites: this.persistence.diskWriter.getPendingCount(),
      queuedOperations: this.operationQueue.pending,
      activeOperations: this.operationQueue.size
    };
  }

  public async flushAllPendingWrites(): Promise<void> {
    await this.operationQueue.add(
      async () => {
        await this.persistence.diskWriter.flushAll();
      },
      { priority: OperationPriority.CRITICAL }
    );
  }

  // ========================================================================
  // DELEGATED OPERATIONS
  // ========================================================================

  public async createEdit(
    noteId: string,
    content: string,
    filePath: string,
    maxVersions: number
  ): Promise<{ entry: VersionHistoryEntry; deletedIds: string[] } | null> {
    // High priority to ensure UI responsiveness during saves
    return this.operationQueue.add(
      () => this.createOp.createEdit(noteId, content, filePath, maxVersions),
      { priority: OperationPriority.HIGH }
    );
  }

  public async saveEdit(
    noteId: string,
    branchName: string,
    editId: string,
    content: string,
    manifest: NoteManifest
  ): Promise<{ size: number; contentHash: string }> {
    return this.operationQueue.add(
      () => this.createOp.saveEdit(noteId, branchName, editId, content, manifest),
      { priority: OperationPriority.HIGH }
    );
  }

  public async getEditContent(
    noteId: string,
    editId: string,
    branchName?: string
  ): Promise<string | null> {
    return this.operationQueue.add(
      () => this.readOp.getEditContent(noteId, editId, branchName),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async getEditManifest(noteId: string): Promise<NoteManifest | null> {
    return this.operationQueue.add(
      () => this.readOp.getEditManifest(noteId),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async getEditHistory(noteId: string): Promise<VersionHistoryEntry[]> {
    // Ensure we don't read while a critical mutation is happening on this note
    // Note: LockManager is re-entrant if we are inside the lock, but here we are outside.
    // We rely on the Worker's mutex for absolute consistency, but queueing here helps ordering.
    return this.operationQueue.add(
      () => this.readOp.getEditHistory(noteId),
      { priority: OperationPriority.NORMAL } // Bumped from LOW to ensure UI refresh isn't starved
    );
  }

  public async saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.saveEditManifest(noteId, manifest),
      { priority: OperationPriority.HIGH }
    );
  }

  public async deleteEditEntry(noteId: string, editId: string): Promise<void> {
    return this.operationQueue.add(
      () => this.deleteOp.deleteEditEntry(noteId, editId),
      { priority: OperationPriority.HIGH }
    );
  }

  public async deleteEdit(
    noteId: string,
    branchName: string,
    editId: string
  ): Promise<void> {
    return this.operationQueue.add(
      () => this.deleteOp.deleteEdit(noteId, branchName, editId),
      { priority: OperationPriority.HIGH }
    );
  }

  public async deleteNoteHistory(noteId: string): Promise<void> {
    return this.operationQueue.add(
      () => this.deleteOp.deleteNoteHistory(noteId),
      { priority: OperationPriority.CRITICAL }
    );
  }

  public async deleteBranch(noteId: string, branchName: string): Promise<void> {
    return this.operationQueue.add(
      () => this.deleteOp.deleteBranch(noteId, branchName),
      { priority: OperationPriority.HIGH }
    );
  }

  public async updateEditMetadata(noteId: string, editId: string, name?: string, description?: string): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.updateEditMetadata(noteId, editId, name, description),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async renameEdit(
    noteId: string,
    oldEditId: string,
    newEditId: string
  ): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.renameEdit(noteId, oldEditId, newEditId),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async renameNote(
    oldNoteId: string,
    newNoteId: string,
    newPath: string
  ): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.renameNote(oldNoteId, newNoteId, newPath),
      { priority: OperationPriority.CRITICAL }
    );
  }

  public async updateNotePath(noteId: string, newPath: string): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.updateNotePath(noteId, newPath),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async loadBranchFromDisk(noteId: string, branchName: string): Promise<void> {
    return this.operationQueue.add(
      () => this.persistence.loadBranchFromDisk(noteId, branchName),
      { priority: OperationPriority.HIGH } // Bumped priority as this blocks initial load
    );
  }
}
