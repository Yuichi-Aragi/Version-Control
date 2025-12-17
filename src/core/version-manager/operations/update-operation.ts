import type { ManifestManager, VersionContentRepository } from '@/core';
import type { UpdateVersionDetails } from '@/core/version-manager/types';
import type { NoteManifest, VersionControlSettings } from '@/types';
import { generateVersionId } from '@/utils/id';
import { VersionValidator } from '@/core/version-manager/validation';
import type { QueueService } from '@/services';

/**
 * Handles the update version details operation.
 * 
 * ENHANCEMENT: Uses a high-level transaction lock (`operation:noteId`) to ensure
 * atomicity when renaming versions (which involves file rename + manifest update).
 */
export class UpdateOperation {
  constructor(
    private readonly manifestManager: ManifestManager,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly getEffectiveSettings: (noteManifest: NoteManifest) => VersionControlSettings,
    private readonly queueService: QueueService
  ) {}

  /**
   * Updates version name and/or description
   */
  async execute(noteId: string, versionId: string, details: UpdateVersionDetails): Promise<string> {
    VersionValidator.validateNoteAndVersionId(noteId, versionId, 'updateVersionDetails');

    return this.queueService.enqueue(`operation:${noteId}`, async () => {
        const version_name = details.name?.trim();
        const version_desc = details.description?.trim();

        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) throw new Error(`Manifest not found for note ${noteId}`);

        const branchName = noteManifest.currentBranch;
        const branch = noteManifest.branches[branchName];
        if (!branch) throw new Error(`Current branch not found for note ${noteId}`);

        const versionData = branch.versions[versionId];
        if (!versionData) throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);

        const effectiveSettings = this.getEffectiveSettings(noteManifest);
        const versionIdFormat = effectiveSettings.versionIdFormat;

        const nameChanged = details.name !== undefined && version_name !== versionData.name;
        const formatUsesName = versionIdFormat.includes('{name}');

        let newVersionId = versionId;

        if (nameChanged && formatUsesName) {
          const originalDate = new Date(versionData.timestamp);
          newVersionId = generateVersionId(effectiveSettings, versionData.versionNumber, version_name, originalDate);

          if (newVersionId !== versionId) {
            try {
              await this.versionContentRepo.rename(noteId, versionId, newVersionId);
            } catch (error) {
              console.error(`VC: Failed to rename version file from ${versionId} to ${newVersionId}. Aborting update.`, error);
              throw error;
            }
          }
        }

        await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
          const b = manifest.branches[manifest.currentBranch];
          if (!b) return;

          if (newVersionId !== versionId) {
            const data = b.versions[versionId];
            if (data) {
              delete b.versions[versionId];
              b.versions[newVersionId] = data;
            }
          }

          const targetVersionData = b.versions[newVersionId];
          if (!targetVersionData) return;

          if (details.name !== undefined) {
            if (version_name) {
              targetVersionData.name = version_name;
            } else {
              delete targetVersionData.name;
            }
          }

          if (details.description !== undefined) {
            if (version_desc) {
              targetVersionData.description = version_desc;
            } else {
              delete targetVersionData.description;
            }
          }

          manifest.lastModified = new Date().toISOString();
        });

        return newVersionId;
    });
  }
}
