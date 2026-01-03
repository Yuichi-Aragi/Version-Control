import type { App, TFile } from 'obsidian';
import type { VersionContentRepository } from '@/core';
import { VersionValidator } from '@/core/version-manager/validation';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';
import type { NoteManager } from '@/core';

/**
 * Handles the restore version operation.
 * 
 * ENHANCEMENT: Uses a high-level transaction lock (`ver:{noteId}`) to ensure
 * consistency during restoration.
 */
export class RestoreOperation {
  constructor(
    private readonly app: App,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly queueService: QueueService,
    private readonly noteManager: NoteManager
  ) {}

  /**
   * Restores a version to a live file
   */
  async execute(liveFile: TFile, noteId: string, versionId: string): Promise<boolean> {
    VersionValidator.validateRestoreParams(liveFile, noteId, versionId);

    return this.queueService.add(
        `ver:${noteId}`, 
        async () => {
            try {
              if (!this.app.vault.getAbstractFileByPath(liveFile.path)) {
                console.warn(`VC: Restoration failed. Note "${liveFile.basename}" no longer exists.`);
                return false;
              }

              const versionContent = await this.versionContentRepo.read(noteId, versionId);
              if (versionContent === null) {
                throw new Error('Could not load version content to restore.');
              }

              // IGNORE INTERNAL WRITE: Prevent auto-save loop when restoring content
              this.noteManager.registerInternalWrite(liveFile.path);

              await this.app.vault.modify(liveFile, versionContent);
              return true;
            } catch (error) {
              console.error(`VC: Failed to restore note ${noteId} to version ${versionId}.`, error);
              throw error;
            }
        },
        { priority: TaskPriority.CRITICAL }
    );
  }
}
