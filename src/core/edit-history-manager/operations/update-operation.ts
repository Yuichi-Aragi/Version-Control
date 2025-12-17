import { produce } from 'immer';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import type { LockManager } from '../infrastructure/lock-manager';
import type { ReadOperation } from './read-operation';

export class UpdateOperation {
  constructor(
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly lockManager: LockManager,
    private readonly readOperation: ReadOperation
  ) {}

  async updateEditMetadata(noteId: string, editId: string, name?: string, description?: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      const existingManifest = await this.readOperation.getEditManifest(noteId);
      if (!existingManifest) throw new Error('Manifest not found');

      const updatedManifest = produce(existingManifest, draft => {
        const branch = draft.branches[draft.currentBranch];
        const editData = branch?.versions[editId];
        
        if (editData) {
            if (name !== undefined) {
                if (name) editData.name = name;
                else delete editData.name;
            }
            
            if (description !== undefined) {
                if (description) editData.description = description;
                else delete editData.description;
            }
            draft.lastModified = new Date().toISOString();
        }
      });

      // Only save if changed
      if (updatedManifest !== existingManifest) {
          const proxy = this.workerClient.ensureWorker();
          await proxy.saveEditManifest(noteId, updatedManifest);
      }
    });
  }

  async renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      if (oldEditId === newEditId) return;
      
      const proxy = this.workerClient.ensureWorker();
      await proxy.renameEdit(noteId, oldEditId, newEditId);

      // We need to schedule a disk write because the blobs changed on disk (via the worker's DB ops)
      // and we need to sync that state to the .vctrl file.
      // We find which branch contains the edit to schedule the write.
      const manifest = await this.readOperation.getEditManifest(noteId);
      if (manifest !== null) {
        for (const [bName, branch] of Object.entries(manifest.branches)) {
          if (branch.versions[newEditId] !== undefined) {
            this.persistence.diskWriter.schedule(noteId, bName);
            break;
          }
        }
      }
    });
  }

  async renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void> {
    return this.lockManager.runSerialized(oldNoteId, async () => {
      if (oldNoteId === newNoteId) return;
      
      const proxy = this.workerClient.ensureWorker();
      await proxy.renameNote(oldNoteId, newNoteId, newPath);
    });
  }

  async updateNotePath(noteId: string, newPath: string): Promise<void> {
    return this.lockManager.runSerialized(noteId, async () => {
      const proxy = this.workerClient.ensureWorker();
      await proxy.updateNotePath(noteId, newPath);
    });
  }

  async saveEditManifest(noteId: string, manifest: any): Promise<void> {
    // This is typically called within other locked operations or during load,
    // but ensuring serialization here adds an extra layer of safety.
    return this.lockManager.runSerialized(noteId, async () => {
      const proxy = this.workerClient.ensureWorker();
      await proxy.saveEditManifest(noteId, manifest);
    });
  }
}
