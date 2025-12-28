import { App } from 'obsidian';
import PQueue from 'p-queue';
import type { NoteManifest, VersionHistoryEntry } from '@/types';
import type { PathService } from '@/core';
import type VersionControlPlugin from '@/main';
import { EditWorkerManager } from './infrastructure/worker-client';
import { PersistenceService } from './persistence/persistence-service';
import { CreateOperation } from './operations/create-operation';
import { ReadOperation } from './operations/read-operation';
import { UpdateOperation } from './operations/update-operation';
import { DeleteOperation } from './operations/delete-operation';
import { OperationPriority, type EditHistoryStats } from './types';
import type { QueueService } from '@/services';

export class EditHistoryManager {
  private readonly workerClient: EditWorkerManager;
  public readonly persistence: PersistenceService;
  private readonly operationQueue: PQueue;

  private readonly createOp: CreateOperation;
  private readonly readOp: ReadOperation;
  private readonly updateOp: UpdateOperation;
  private readonly deleteOp: DeleteOperation;

  constructor(
    app: App,
    private readonly plugin: VersionControlPlugin,
    pathService: PathService,
    private readonly queueService: QueueService
  ) {
    this.workerClient = new EditWorkerManager();
    this.persistence = new PersistenceService(app, pathService, this.workerClient, this.plugin);
    // Queue for throttling general operations, distinct from the strict serialization queue
    this.operationQueue = new PQueue({ concurrency: 4 });

    // Initialize Operations
    this.readOp = new ReadOperation(this.workerClient, this.queueService);
    
    this.deleteOp = new DeleteOperation(
      app,
      this.plugin,
      pathService,
      this.workerClient,
      this.persistence,
      this.queueService
    );

    this.createOp = new CreateOperation(
      this.plugin,
      this.workerClient,
      this.persistence,
      this.queueService,
      this.deleteOp
    );

    this.updateOp = new UpdateOperation(
      this.plugin,
      this.workerClient,
      this.persistence,
      this.queueService
    );
  }

  public initialize(): void {
    this.workerClient.initialize();
  }

  public async terminate(): Promise<void> {
    this.persistence.shutdown();
    this.operationQueue.clear();
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
    branchName: string,
    content: string,
    filePath: string,
    maxVersions: number
  ): Promise<{ entry: VersionHistoryEntry; deletedIds: string[] } | null> {
    // High priority to ensure UI responsiveness during saves
    return this.operationQueue.add(
      () => this.createOp.createEdit(noteId, branchName, content, filePath, maxVersions),
      { priority: OperationPriority.HIGH }
    );
  }

  public async saveEdit(
    noteId: string,
    branchName: string,
    editId: string,
    content: string,
    manifest: NoteManifest,
    forcePersistence = false
  ): Promise<{ size: number; contentHash: string }> {
    return this.operationQueue.add(
      () => this.createOp.saveEdit(noteId, branchName, editId, content, manifest, forcePersistence),
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
    return this.operationQueue.add(
      () => this.readOp.getEditHistory(noteId),
      { priority: OperationPriority.NORMAL }
    );
  }

  public async saveEditManifest(noteId: string, manifest: NoteManifest, forcePersistence = false): Promise<void> {
    return this.operationQueue.add(
      () => this.updateOp.saveEditManifest(noteId, manifest, forcePersistence),
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
      { priority: OperationPriority.HIGH }
    );
  }
}
