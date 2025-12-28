import { App } from 'obsidian';
import type { PathService } from '@/core';
import type VersionControlPlugin from '@/main';
import type { NoteManifest } from '@/types';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import { produce } from 'immer';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';

export class DeleteOperation {
  constructor(
    private readonly app: App,
    private readonly plugin: VersionControlPlugin,
    private readonly pathService: PathService,
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly queueService: QueueService
  ) {}

  async deleteEditEntry(noteId: string, editId: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            const existingManifest = await proxy.getEditManifest(noteId);
            if (!existingManifest) throw new Error('Manifest not found');

            const branchName = existingManifest.currentBranch;
            const branch = existingManifest.branches[branchName];

            if (branch && branch.versions[editId]) {
                const updatedManifest = produce(existingManifest, draft => {
                    delete draft.branches[branchName]!.versions[editId];
                    draft.lastModified = new Date().toISOString();
                });
                
                await proxy.saveEditManifest(noteId, updatedManifest);
                await proxy.deleteEdit(noteId, branchName, editId);
                
                if (await this.shouldPersist(updatedManifest, branchName)) {
                    this.persistence.diskWriter.schedule(noteId, branchName);
                }
            }
        },
        { priority: TaskPriority.HIGH }
    );
  }

  async deleteEdit(noteId: string, branchName: string, editId: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            await proxy.deleteEdit(noteId, branchName, editId);
            
            // We need manifest to check persistence settings
            const manifest = await proxy.getEditManifest(noteId);
            if (manifest && await this.shouldPersist(manifest, branchName)) {
                this.persistence.diskWriter.schedule(noteId, branchName);
            }
        },
        { priority: TaskPriority.HIGH }
    );
  }

  async deleteNoteHistory(noteId: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            const proxy = this.workerClient.ensureWorker();
            await proxy.deleteNoteHistory(noteId);

            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            const branchesPath = `${noteDbPath}/branches`;
            
            const exists = await this.app.vault.adapter.exists(branchesPath);
            if (exists) {
              await this.app.vault.adapter.rmdir(branchesPath, true);
            }
        },
        { priority: TaskPriority.CRITICAL }
    );
  }

  async deleteBranch(noteId: string, branchName: string): Promise<void> {
    return this.queueService.add(
        `edit:${noteId}`,
        async () => {
            this.persistence.diskWriter.cancel(noteId, branchName);
            
            const proxy = this.workerClient.ensureWorker();
            await proxy.deleteBranch(noteId, branchName);

            const branchPath = this.pathService.getBranchPath(noteId, branchName);
            const exists = await this.app.vault.adapter.exists(branchPath);
            
            if (exists) {
              await this.app.vault.adapter.rmdir(branchPath, true);
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
