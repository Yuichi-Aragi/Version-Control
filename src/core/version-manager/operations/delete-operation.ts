import { App, TFile } from 'obsidian';
import type { FrontMatterCache } from 'obsidian';
import type { ManifestManager, VersionContentRepository, PluginEvents } from '@/core';
import { VersionValidator } from '@/core/version-manager/validation';
import { DEFAULT_BRANCH_NAME } from '@/constants';
import type { QueueService } from '@/services';

/**
 * Handles the delete version and branch operations.
 * 
 * ENHANCEMENT: Uses a high-level transaction lock (`operation:noteId`) to ensure
 * no conflicts with saves or restores during deletion.
 */
export class DeleteOperation {
  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly eventBus: PluginEvents,
    private readonly noteIdKey: string,
    private readonly queueService: QueueService
  ) {}

  /**
   * Deletes a single version
   */
  async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
    VersionValidator.validateNoteAndVersionId(noteId, versionId, 'deleteVersion');

    return this.queueService.enqueue(`operation:${noteId}`, async () => {
        try {
          const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
          if (!noteManifest) return false;

          const branchName = noteManifest.currentBranch;
          const branch = noteManifest.branches[branchName];

          if (!branch || !branch.versions[versionId]) {
            console.warn('VC: Version to delete not found in manifest. It may have already been deleted.');
            await this.versionContentRepo.delete(noteId, versionId);
            return true;
          }

          await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
            const b = manifest.branches[branchName];
            if (b) {
              delete b.versions[versionId];
              manifest.lastModified = new Date().toISOString();
            }
          });

          await this.versionContentRepo.delete(noteId, versionId);
          this.eventBus.trigger('version-deleted', noteId);
          return true;
        } catch (error) {
          console.error(`VC: Failed to delete version ${versionId} for note ${noteId}.`, error);
          throw error;
        }
    });
  }

  /**
   * Deletes all versions in the current branch
   */
  async deleteAllVersionsInCurrentBranch(noteId: string): Promise<boolean> {
    VersionValidator.validateNoteId(noteId, 'deleteAllVersionsInCurrentBranch');

    return this.queueService.enqueue(`operation:${noteId}`, async () => {
        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) return false;

        const branchName = noteManifest.currentBranch;
        const branch = noteManifest.branches[branchName];

        if (!branch) return true;

        const versionsToDelete = Object.keys(branch.versions);
        if (versionsToDelete.length === 0) return true;

        try {
          await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
            const b = manifest.branches[branchName];
            if (b) {
              b.versions = {};
              b.totalVersions = 0; 
              manifest.lastModified = new Date().toISOString();
            }
          });

          // Delete physical files
          for (const versionId of versionsToDelete) {
            await this.versionContentRepo.delete(noteId, versionId);
          }

          this.eventBus.trigger('version-deleted', noteId);
          return true;
        } catch (error) {
          console.error(`VC: Failed to delete all versions for note ${noteId}.`, error);
          throw error;
        }
    });
  }

  /**
   * Deletes an entire branch
   */
  async deleteBranch(noteId: string, branchName: string): Promise<boolean> {
    VersionValidator.validateBranchDeletion(noteId, branchName);

    return this.queueService.enqueue(`operation:${noteId}`, async () => {
        try {
          const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
          if (!noteManifest || !noteManifest.branches[branchName]) {
            console.warn(`VC: Branch to delete '${branchName}' not found.`);
            return true;
          }

          if (Object.keys(noteManifest.branches).length === 1) {
            const liveFilePath = noteManifest.notePath;
            await this.manifestManager.deleteNoteEntry(noteId);
            const file = this.app.vault.getAbstractFileByPath(liveFilePath);
            if (file instanceof TFile && file.extension === 'md') {
              await this.cleanupFrontmatter(liveFilePath, noteId);
            }
            this.eventBus.trigger('history-deleted', noteId);
            return true;
          }

          const versionsToDelete = Object.keys(noteManifest.branches[branchName]?.versions ?? {});

          await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
            delete manifest.branches[branchName];
            if (manifest.currentBranch === branchName) {
              manifest.currentBranch = Object.keys(manifest.branches)[0] ?? DEFAULT_BRANCH_NAME;
            }
            manifest.lastModified = new Date().toISOString();
          });

          for (const versionId of versionsToDelete) {
            await this.versionContentRepo.delete(noteId, versionId);
          }

          this.eventBus.trigger('version-deleted', noteId);
          return true;
        } catch (error) {
          console.error(`VC: Failed to delete branch ${branchName} for note ${noteId}.`, error);
          throw error;
        }
    });
  }

  /**
   * Cleans up frontmatter after deleting all versions
   */
  private async cleanupFrontmatter(filePath: string, expectedNoteId: string): Promise<void> {
    const liveFile = this.app.vault.getAbstractFileByPath(filePath);
    if (liveFile instanceof TFile) {
      try {
        await this.app.fileManager.processFrontMatter(liveFile, (fm: FrontMatterCache) => {
          if (fm[this.noteIdKey] === expectedNoteId) {
            delete fm[this.noteIdKey];
          }
        });
      } catch (fmError) {
        console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
      }
    }
  }
}
