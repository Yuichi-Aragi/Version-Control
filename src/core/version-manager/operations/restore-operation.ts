import type { App, TFile } from 'obsidian';
import type { VersionContentRepository } from '@/core';
import { VersionValidator } from '@/core/version-manager/validation';

/**
 * Handles the restore version operation
 */
export class RestoreOperation {
  constructor(
    private readonly app: App,
    private readonly versionContentRepo: VersionContentRepository
  ) {}

  /**
   * Restores a version to a live file
   */
  async execute(liveFile: TFile, noteId: string, versionId: string): Promise<boolean> {
    VersionValidator.validateRestoreParams(liveFile, noteId, versionId);

    try {
      if (!this.app.vault.getAbstractFileByPath(liveFile.path)) {
        console.warn(`VC: Restoration failed. Note "${liveFile.basename}" no longer exists.`);
        return false;
      }

      const versionContent = await this.versionContentRepo.read(noteId, versionId);
      if (versionContent === null) {
        throw new Error('Could not load version content to restore.');
      }

      await this.app.vault.modify(liveFile, versionContent);
      return true;
    } catch (error) {
      console.error(`VC: Failed to restore note ${noteId} to version ${versionId}.`, error);
      throw error;
    }
  }
}
