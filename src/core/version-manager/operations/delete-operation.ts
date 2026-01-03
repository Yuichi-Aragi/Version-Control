import { App, TFile } from 'obsidian';
import type { ManifestManager, VersionContentRepository, PluginEvents, EditHistoryManager } from '@/core';
import { VersionValidator } from '@/core/version-manager/validation';
import { DEFAULT_BRANCH_NAME } from '@/constants';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';
import { updateFrontmatter, getFrontmatterKey, DELETE } from "@/utils/frontmatter";
import type VersionControlPlugin from '@/main';
import type { NoteManager } from '@/core';

/**
 * Handles the delete version and branch operations.
 * 
 * ENHANCEMENT: Uses a high-level transaction lock (`ver:{noteId}`) to ensure
 * no conflicts with saves or restores during deletion.
 * 
 * ENHANCEMENT: Coordinates with EditHistoryManager to ensure complete cleanup
 * of all associated data (versions, edits, timeline) when deletion occurs.
 */
export class DeleteOperation {
  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly eventBus: PluginEvents,
    private readonly plugin: VersionControlPlugin,
    private readonly queueService: QueueService,
    private readonly editHistoryManager: EditHistoryManager,
    private readonly noteManager: NoteManager
  ) {}

  private get noteIdKey(): string {
      return this.plugin.settings.noteIdFrontmatterKey;
  }

  private get legacyNoteIdKeys(): string[] {
      return this.plugin.settings.legacyNoteIdFrontmatterKeys || [];
  }

  /**
   * Deletes a single version
   */
  async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
    VersionValidator.validateNoteAndVersionId(noteId, versionId, 'deleteVersion');

    return this.queueService.add(
        `ver:${noteId}`, 
        async () => {
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
        },
        { priority: TaskPriority.HIGH }
    );
  }

  /**
   * Deletes all versions in the current branch
   */
  async deleteAllVersionsInCurrentBranch(noteId: string): Promise<boolean> {
    VersionValidator.validateNoteId(noteId, 'deleteAllVersionsInCurrentBranch');

    return this.queueService.add(
        `ver:${noteId}`, 
        async () => {
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
        },
        { priority: TaskPriority.HIGH }
    );
  }

  /**
   * Deletes an entire branch.
   * If it's the last branch, it deletes the entire note entry and all associated history.
   */
  async deleteBranch(noteId: string, branchName: string): Promise<boolean> {
    VersionValidator.validateBranchDeletion(noteId, branchName);

    return this.queueService.add(
        `ver:${noteId}`, 
        async () => {
            try {
              const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
              if (!noteManifest || !noteManifest.branches[branchName]) {
                console.warn(`VC: Branch to delete '${branchName}' not found.`);
                return true;
              }

              // CHECK IF THIS IS THE LAST BRANCH
              if (Object.keys(noteManifest.branches).length === 1) {
                const liveFilePath = noteManifest.notePath;
                
                // 1. Clean up Edit History (Cancels writes, clears IDB, deletes physical branch folders)
                // This must happen BEFORE deleting the note entry to prevent race conditions where
                // a pending edit history write recreates the folder.
                await this.editHistoryManager.deleteNoteHistory(noteId);

                // 2. Delete Physical Folder & Central Manifest Entry
                await this.manifestManager.deleteNoteEntry(noteId);
                
                // 3. Cleanup Frontmatter in the live file
                const file = this.app.vault.getAbstractFileByPath(liveFilePath);
                if (file instanceof TFile && file.extension === 'md') {
                  await this.cleanupFrontmatter(liveFilePath, noteId);
                }
                
                // 4. Trigger event to notify TimelineManager (and UI) to clear remaining state
                this.eventBus.trigger('history-deleted', noteId);
                return true;
              }

              // STANDARD BRANCH DELETION
              
              // 1. Clean up Edit History for this specific branch
              await this.editHistoryManager.deleteBranch(noteId, branchName);

              // 2. Delete Versions for this branch
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
        },
        { priority: TaskPriority.HIGH }
    );
  }

  /**
   * Cleans up frontmatter after deleting all versions
   */
  private async cleanupFrontmatter(filePath: string, expectedNoteId: string): Promise<void> {
    const liveFile = this.app.vault.getAbstractFileByPath(filePath);
    if (liveFile instanceof TFile) {
      try {
        const keyResult = await getFrontmatterKey(this.app, liveFile, this.noteIdKey);
        
        // If the file has the expected ID, we nuke it AND legacy keys.
        if (keyResult.success && keyResult.data === expectedNoteId) {
            // IGNORE INTERNAL WRITE: Prevent metadata change event loop
            this.noteManager.registerInternalWrite(liveFile.path);

            const updates: Record<string, any> = {
                [this.noteIdKey]: DELETE
            };
            for (const key of this.legacyNoteIdKeys) {
                updates[key] = DELETE;
            }
            
            const result = await updateFrontmatter(this.app, liveFile, updates);
            if (!result.success) {
                throw result.error || new Error("Failed to cleanup frontmatter");
            }
        }
      } catch (fmError) {
        console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
      }
    }
  }
}
