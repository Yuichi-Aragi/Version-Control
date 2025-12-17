import { App } from 'obsidian';
import type { PathService } from '@/core';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import type { AtomicOperationCoordinator } from '../infrastructure/coordinator';
import type { LockManager } from '../infrastructure/lock-manager';
import type { ReadOperation } from './read-operation';
import { produce } from 'immer';

export class DeleteOperation {
  constructor(
    private readonly app: App,
    private readonly pathService: PathService,
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly coordinator: AtomicOperationCoordinator,
    private readonly lockManager: LockManager,
    private readonly readOperation: ReadOperation
  ) {}

  async deleteEditEntry(noteId: string, editId: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      const existingManifest = await this.readOperation.getEditManifest(noteId);
      if (!existingManifest) throw new Error('Manifest not found');

      const branchName = existingManifest.currentBranch;
      const branch = existingManifest.branches[branchName];

      if (branch && branch.versions[editId]) {
        // Use immutable update pattern
        const updatedManifest = produce(existingManifest, draft => {
            delete draft.branches[branchName]!.versions[editId];
            draft.lastModified = new Date().toISOString();
        });
        
        // 1. Save manifest first (Logical Deletion)
        const proxy = this.workerClient.ensureWorker();
        await proxy.saveEditManifest(noteId, updatedManifest);
        
        // 2. Then delete content (Physical Deletion)
        // Even if this fails, the entry is gone from the manifest, so it's consistent from user POV.
        // The blob will just be an orphan.
        await this.deleteEdit(noteId, branchName, editId);
      }
    });
  }

  async deleteEdit(noteId: string, branchName: string, editId: string): Promise<void> {
    const operationId = `delete:${noteId}:${branchName}:${editId}`;
    const key = `${noteId}:${branchName}`;
    
    await this.coordinator.beginAtomicOperation(key, operationId);

    try {
      const proxy = this.workerClient.ensureWorker();
      await proxy.deleteEdit(noteId, branchName, editId);
      this.persistence.diskWriter.schedule(noteId, branchName);
    } finally {
      this.coordinator.completeAtomicOperation(key, operationId);
    }
  }

  async deleteNoteHistory(noteId: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      const operationId = `delete-note:${noteId}`;
      const key = `${noteId}:*`;
      
      await this.coordinator.beginAtomicOperation(key, operationId);

      try {
        const proxy = this.workerClient.ensureWorker();
        await proxy.deleteNoteHistory(noteId);

        const noteDbPath = this.pathService.getNoteDbPath(noteId);
        const branchesPath = `${noteDbPath}/branches`;
        
        const exists = await this.app.vault.adapter.exists(branchesPath);
        if (exists) {
          await this.app.vault.adapter.rmdir(branchesPath, true);
        }
      } finally {
        this.coordinator.completeAtomicOperation(key, operationId);
      }
    });
  }

  async deleteBranch(noteId: string, branchName: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      const operationId = `delete-branch:${noteId}:${branchName}`;
      const key = `${noteId}:${branchName}`;
      
      await this.coordinator.beginAtomicOperation(key, operationId);

      try {
        this.persistence.diskWriter.cancel(noteId, branchName);
        
        const proxy = this.workerClient.ensureWorker();
        await proxy.deleteBranch(noteId, branchName);

        const branchPath = this.pathService.getBranchPath(noteId, branchName);
        const exists = await this.app.vault.adapter.exists(branchPath);
        
        if (exists) {
          await this.app.vault.adapter.rmdir(branchPath, true);
        }
      } finally {
        this.coordinator.completeAtomicOperation(key, operationId);
      }
    });
  }
}
