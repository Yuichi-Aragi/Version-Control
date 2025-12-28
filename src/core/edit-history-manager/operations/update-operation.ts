import { produce } from 'immer';
import type VersionControlPlugin from '@/main';
import type { NoteManifest } from '@/types';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';

export class UpdateOperation {
  constructor(
    private readonly plugin: VersionControlPlugin,
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly queueService: QueueService
  ) {}

  async updateEditMetadata(noteId: string, editId: string, name?: string, description?: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            const existingManifest = await proxy.getEditManifest(noteId);
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

            if (updatedManifest !== existingManifest) {
                await proxy.saveEditManifest(noteId, updatedManifest);
                if (await this.shouldPersist(updatedManifest, updatedManifest.currentBranch)) {
                    this.persistence.diskWriter.schedule(noteId, updatedManifest.currentBranch);
                }
            }
        },
        { priority: TaskPriority.NORMAL }
    );
  }

  async renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            if (oldEditId === newEditId) return;
            
            const proxy = this.workerClient.ensureWorker();
            await proxy.renameEdit(noteId, oldEditId, newEditId);

            const manifest = await proxy.getEditManifest(noteId);
            if (manifest !== null) {
                for (const [bName, branch] of Object.entries(manifest.branches)) {
                    if (branch.versions[newEditId] !== undefined) {
                        if (await this.shouldPersist(manifest, bName)) {
                            this.persistence.diskWriter.schedule(noteId, bName);
                        }
                        break;
                    }
                }
            }
        },
        { priority: TaskPriority.NORMAL }
    );
  }

  async renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void> {
    return this.queueService.add(
        [`edit:${oldNoteId}`, `edit:${newNoteId}`],
        async () => {
            if (oldNoteId === newNoteId) return;
            
            const proxy = this.workerClient.ensureWorker();
            await proxy.renameNote(oldNoteId, newNoteId, newPath);

            const newManifest = await proxy.getEditManifest(newNoteId);
            if (newManifest) {
                for (const branchName of Object.keys(newManifest.branches)) {
                    if (await this.shouldPersist(newManifest, branchName)) {
                        this.persistence.diskWriter.schedule(newNoteId, branchName);
                    }
                }
            }
        },
        { priority: TaskPriority.CRITICAL }
    );
  }

  async updateNotePath(noteId: string, newPath: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            await proxy.updateNotePath(noteId, newPath);
            
            const manifest = await proxy.getEditManifest(noteId);
            if (manifest) {
                for (const branchName of Object.keys(manifest.branches)) {
                    if (await this.shouldPersist(manifest, branchName)) {
                        this.persistence.diskWriter.schedule(noteId, branchName);
                    }
                }
            }
        },
        { priority: TaskPriority.NORMAL }
    );
  }

  async saveEditManifest(noteId: string, manifest: NoteManifest, forcePersistence = false): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            await proxy.saveEditManifest(noteId, manifest);
            
            if (manifest.currentBranch) {
                if (forcePersistence || await this.shouldPersist(manifest, manifest.currentBranch)) {
                    this.persistence.diskWriter.schedule(noteId, manifest.currentBranch);
                }
            }
        },
        { priority: TaskPriority.HIGH }
    );
  }

  private async shouldPersist(manifest: NoteManifest, branchName: string): Promise<boolean> {
      const globalDefaults = this.plugin.settings.editHistorySettings;
      const branch = manifest.branches[branchName];
      const perBranchSettings = branch?.settings;
      const isUnderGlobalInfluence = perBranchSettings?.isGlobal !== false;

      if (isUnderGlobalInfluence) {
          return globalDefaults.enableDiskPersistence ?? true;
      } else {
          return perBranchSettings?.enableDiskPersistence ?? globalDefaults.enableDiskPersistence ?? true;
      }
  }
}
