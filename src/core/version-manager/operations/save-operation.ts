import type { App, TFile } from 'obsidian';
import type { ManifestManager, NoteManager, VersionContentRepository, PluginEvents } from '@/core';
import type { SaveVersionOptions, SaveVersionResult } from '@/core/version-manager/types';
import { generateVersionId } from '@/utils/id';
import { VersionValidator } from '@/core/version-manager/validation';
import { MetadataBuilder, DuplicateDetector, StatsPreparer } from '@/core/version-manager/helpers';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';

/**
 * Handles the save version operation.
 * 
 * ENHANCEMENT: Uses a high-level transaction lock (`ver:{noteId}`) to ensure
 * absolute sequentiality and consistency of the save process (Read -> ID Gen -> Write -> Update).
 */
export class SaveOperation {
  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly noteManager: NoteManager,
    private readonly versionContentRepo: VersionContentRepository,
    private readonly eventBus: PluginEvents,
    private readonly queueService: QueueService
  ) {}

  /**
   * Saves a new version of a file
   */
  async execute(file: TFile, options: SaveVersionOptions): Promise<SaveVersionResult> {
    VersionValidator.validateFile(file);

    const { force = false, isAuto = false, settings, name } = options;

    const noteId = await this.noteManager.getOrCreateNoteId(file);
    if (!noteId) {
      throw new Error('Could not get or create a note ID for the file.');
    }

    // TRANSACTION LOCK: Serialize all version operations for this noteId
    return this.queueService.add(
        `ver:${noteId}`, 
        async () => {
            let noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest) {
              console.log(`VC: First version for "${file.path}". Creating database entry.`);
              noteManifest = await this.manifestManager.createNoteEntry(noteId, file.path);
            }

            const branchName = noteManifest.currentBranch;
            const currentBranch = noteManifest.branches[branchName];
            if (!currentBranch) {
              throw new Error(`Current branch "${branchName}" not found in manifest for note ${noteId}.`);
            }

            if (!(await this.app.vault.adapter.exists(file.path))) {
              throw new Error(`File to be saved does not exist at path: ${file.path}`);
            }

            const contentToSave = await this.app.vault.adapter.read(file.path);
            const latestContent = await this.versionContentRepo.getLatestVersionContent(noteId, noteManifest);

            if (DuplicateDetector.shouldSkipMinimalChanges(latestContent, contentToSave, isAuto, settings)) {
              return { status: 'skipped_min_lines', newVersionEntry: null, displayName: '', newNoteId: noteId };
            }

            if (!force && DuplicateDetector.isDuplicate(latestContent, contentToSave)) {
              return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
            }

            // Calculation happens inside lock, ensuring sequential IDs
            const existingVersionNumbers = Object.values(currentBranch.versions).map(v => v.versionNumber);
            const nextVersionNumber = MetadataBuilder.calculateNextVersionNumber(existingVersionNumbers);

            const version_name = (name || '').trim();
            const versionId = generateVersionId(settings, nextVersionNumber, version_name);

            try {
              const { size } = await this.versionContentRepo.write(noteId, versionId, contentToSave);
              const textStats = StatsPreparer.prepareStats(contentToSave);
              const timestamp = new Date().toISOString();

              const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[branchName];
                if (branch) {
                  const currentVersions = Object.values(branch.versions);
                  const currentMax = currentVersions.length > 0 ? Math.max(...currentVersions.map(v => v.versionNumber)) : 0;
                  // Re-verify version number inside manifest update lock just in case
                  const finalVersionNumber = Math.max(currentMax + 1, nextVersionNumber);

                  const metadata = MetadataBuilder.buildVersionMetadata(
                    finalVersionNumber,
                    timestamp,
                    size,
                    textStats,
                    version_name || undefined
                  );

                  branch.versions[versionId] = metadata;
                  branch.totalVersions = finalVersionNumber;
                  manifest.lastModified = timestamp;
                }
              });

              const savedVersionData = updatedManifest.branches[branchName]?.versions[versionId];
              if (!savedVersionData) {
                throw new Error(`Failed to retrieve saved version data for version ${versionId} from manifest after update.`);
              }

              const displayName = MetadataBuilder.generateDisplayName(savedVersionData.versionNumber, version_name || undefined);
              this.eventBus.trigger('version-saved', noteId);

              return {
                status: 'saved',
                newVersionEntry: {
                  id: versionId,
                  noteId,
                  notePath: file.path,
                  branchName,
                  versionNumber: savedVersionData.versionNumber,
                  timestamp,
                  size,
                  ...(version_name && { name: version_name }),
                  wordCount: savedVersionData.wordCount,
                  wordCountWithMd: savedVersionData.wordCountWithMd,
                  charCount: savedVersionData.charCount,
                  charCountWithMd: savedVersionData.charCountWithMd,
                  lineCount: savedVersionData.lineCount,
                  lineCountWithoutMd: savedVersionData.lineCountWithoutMd,
                },
                displayName,
                newNoteId: noteId,
              };
            } catch (error) {
              console.error(`VC: CRITICAL FAILURE in saveNewVersionForFile for "${file.path}". Rolling back.`, error);
              await this.versionContentRepo.delete(noteId, versionId).catch((cleanupError) => {
                console.error(`VC: FAILED to clean up orphaned version file after an error: ${versionId}`, cleanupError);
              });
              this.manifestManager.invalidateNoteManifestCache(noteId);
              throw error;
            }
        },
        { priority: TaskPriority.CRITICAL }
    );
  }
}
