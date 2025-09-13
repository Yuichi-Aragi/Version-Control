import { App, TFile, MarkdownView, TFolder, type FrontMatterCache } from 'obsidian';
import { map, orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { diffLines } from 'diff';
import { ManifestManager } from './manifest-manager';
import { NoteManager } from './note-manager';
import type { VersionControlSettings, VersionHistoryEntry } from '../types';
import { generateUniqueFilePath } from '../utils/file';
import { NOTE_FRONTMATTER_KEY } from '../constants';
import { PluginEvents } from './plugin-events';
import { generateUniqueId } from '../utils/id';
import { VersionContentRepository } from './storage/version-content-repository';
import { TYPES } from '../types/inversify.types';

/**
 * Manages the core business logic for versioning operations like saving,
 * restoring, deleting, and retrieving versions. It orchestrates other services
 * and repositories to perform its tasks, relying on them for concurrency control.
 */
@injectable()
export class VersionManager {
  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.ManifestManager) private readonly manifestManager: ManifestManager,
    @inject(TYPES.NoteManager) private readonly noteManager: NoteManager,
    @inject(TYPES.VersionContentRepo) private readonly versionContentRepo: VersionContentRepository,
    @inject(TYPES.EventBus) private readonly eventBus: PluginEvents
  ) {}

  /**
   * Saves a new version of a given file. This method encapsulates the entire
   * process, including getting or creating a note ID and its database entry.
   * @param file The TFile to save a version of.
   * @param options Options for saving, including forcing a save, marking as auto-save, and providing settings.
   * @returns An object indicating if the version was saved, was a duplicate, or was skipped due to minimal changes.
   */
  public async saveNewVersionForFile(
    file: TFile,
    options: {
      name?: string;
      force?: boolean;
      isAuto?: boolean;
      settings: VersionControlSettings;
    }
  ): Promise<{ status: 'saved' | 'duplicate' | 'skipped_min_lines'; newVersionEntry: VersionHistoryEntry | null; displayName: string; newNoteId: string }> {
    const { force = false, isAuto = false, settings, name } = options;
    if (!file) {
      throw new Error('Invalid file provided to saveNewVersionForFile.');
    }

    // 1. Ensures an ID exists in the note's frontmatter.
    const noteId = await this.noteManager.getOrCreateNoteId(file);
    if (!noteId) {
      throw new Error('Could not get or create a note ID for the file.');
    }

    // 2. Check if the database entry (manifest) for this note exists. If not, create it.
    // This defers database creation until the first version is actually saved.
    let noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) {
      console.log(`VC: First version for "${file.path}". Creating database entry.`);
      noteManifest = await this.manifestManager.createNoteEntry(noteId, file.path);
    }

    // 3. Get content to save, prioritizing the active editor, then a direct disk read.
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    let contentToSave: string;

    if (activeMarkdownView?.file?.path === file.path) {
        // The most up-to-date content is in the active editor, including unsaved changes.
        contentToSave = activeMarkdownView.editor.getValue();
    } else {
        // If the file is not in the active editor, read directly from disk via the adapter
        // to bypass Obsidian's cache and get the definitive file state.
        if (!(await this.app.vault.adapter.exists(file.path))) {
            throw new Error(`File to be saved does not exist at path: ${file.path}`);
        }
        contentToSave = await this.app.vault.adapter.read(file.path);
    }

    // 4. Get latest content for comparison checks.
    const latestContent = await this.versionContentRepo.getLatestVersionContent(noteId, noteManifest);

    // 5. Check for minimum lines changed on auto-save, if enabled.
    if (isAuto && settings.enableMinLinesChangedCheck && latestContent !== null) {
        const changes = diffLines(latestContent, contentToSave);
        let changedLines = 0;
        for (const part of changes) {
            if (part.added || part.removed) {
                // The 'count' property is guaranteed to exist on added/removed parts.
                changedLines += part.count!;
            }
        }

        if (changedLines < settings.minLinesChanged) {
            return { status: 'skipped_min_lines', newVersionEntry: null, displayName: '', newNoteId: noteId };
        }
    }

    // 6. Check for duplicate content, unless forced.
    if (!force) {
      if (latestContent !== null && latestContent === contentToSave) {
        return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
      }
    }

    const versionId = generateUniqueId();

    try {
      // 7. Write version content file (queued by noteId inside the repository).
      const { size } = await this.versionContentRepo.write(noteId, versionId, contentToSave);
      const version_name = (name || '').trim();
      const timestamp = new Date().toISOString();

      // 8. Update the note's manifest (also queued by noteId).
      const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
        const versionNumber = (manifest.totalVersions || 0) + 1;
        manifest.versions[versionId] = {
          versionNumber,
          timestamp,
          size,
          ...(version_name && { name: version_name }),
        };
        manifest.totalVersions = versionNumber;
        manifest.lastModified = timestamp;
      });

      const savedVersionData = updatedManifest.versions[versionId];
      if (!savedVersionData) {
        throw new Error(`Failed to retrieve saved version data for version ${versionId} from manifest after update.`);
      }

      const displayName = version_name ? `"${version_name}" (V${savedVersionData.versionNumber})` : `Version ${savedVersionData.versionNumber}`;
      this.eventBus.trigger('version-saved', noteId);

      return {
        status: 'saved',
        newVersionEntry: {
          id: versionId,
          noteId,
          notePath: file.path,
          versionNumber: savedVersionData.versionNumber,
          timestamp,
          size,
          ...(version_name && { name: version_name }),
        },
        displayName,
        newNoteId: noteId,
      };
    } catch (error) {
      console.error(`VC: CRITICAL FAILURE in saveNewVersionForFile for "${file.path}". Rolling back.`, error);
      // Attempt to clean up the orphaned version file (this delete is also queued).
      await this.versionContentRepo.delete(noteId, versionId).catch((cleanupError) => {
        console.error(`VC: FAILED to clean up orphaned version file after an error: ${versionId}`, cleanupError);
      });
      // Invalidate the manifest cache to force a reload on next read.
      this.manifestManager.invalidateNoteManifestCache(noteId);
      throw error;
    }
  }

  public async updateVersionDetails(noteId: string, versionId: string, name: string): Promise<void> {
    if (!noteId || !versionId) {
      throw new Error('Invalid noteId or versionId for updateVersionDetails.');
    }
    const version_name = name.trim();
    await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
      const versionData = manifest.versions[versionId];
      if (!versionData) {
        throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);
      }
      if (version_name) {
        versionData.name = version_name;
      } else {
        delete versionData.name;
      }
      manifest.lastModified = new Date().toISOString();
    });
  }

  public async getVersionHistory(noteId: string): Promise<VersionHistoryEntry[]> {
    if (!noteId) {
      return [];
    }
    try {
      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      if (!noteManifest || !noteManifest.versions) {
        return [];
      }

      const history = map(noteManifest.versions, (data, id) => ({
        id,
        noteId,
        notePath: noteManifest.notePath,
        versionNumber: data.versionNumber,
        timestamp: data.timestamp,
        size: data.size,
        ...(data.name && { name: data.name }),
      }));

      return orderBy(history, ['versionNumber'], ['desc']);
    } catch (error) {
      console.error(`VC: Failed to get version history for note ${noteId}.`, error);
      throw new Error(`Failed to get version history for note ${noteId}.`);
    }
  }

  public async getVersionContent(noteId: string, versionId: string): Promise<string | null> {
    return this.versionContentRepo.read(noteId, versionId);
  }

  public async restoreVersion(liveFile: TFile, noteId: string, versionId: string): Promise<boolean> {
    if (!liveFile || !noteId || !versionId) {
      throw new Error('Invalid parameters for version restoration.');
    }
    try {
      if (!this.app.vault.getAbstractFileByPath(liveFile.path)) {
        // Don't throw, just warn and return false. The file is gone.
        console.warn(`VC: Restoration failed. Note "${liveFile.basename}" no longer exists.`);
        return false;
      }
      const versionContent = await this.getVersionContent(noteId, versionId);
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

  public async createDeviation(noteId: string, versionId: string, targetFolder: TFolder | null): Promise<TFile | null> {
    if (!noteId || !versionId) {
      throw new Error('Invalid parameters for creating deviation.');
    }
    
    const versionContent = await this.getVersionContent(noteId, versionId);
    if (versionContent === null) {
      throw new Error('Could not load version content for deviation.');
    }

    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    const originalFile = noteManifest ? this.app.vault.getAbstractFileByPath(noteManifest.notePath) : null;
    const originalTFile = originalFile instanceof TFile ? originalFile : null;
    const baseName = originalTFile?.basename || 'Untitled Version';

    let parentPath = targetFolder?.isRoot() ? '' : targetFolder?.path ?? originalTFile?.parent?.path ?? '';
    if (parentPath === '/') {
      parentPath = '';
    }

    const newFileNameBase = `${baseName} (from V${versionId.substring(0, 6)}...)`;
    const newFilePath = await generateUniqueFilePath(this.app, newFileNameBase, parentPath);

    // Add the path to the exclusion list BEFORE creating the file to prevent race conditions.
    this.noteManager.addPendingDeviation(newFilePath);

    try {
      // Create the new file with the original content (including vc-id)
      const newFile = await this.app.vault.create(newFilePath, versionContent);
      if (!newFile) {
        throw new Error('Failed to create the new note file for deviation.');
      }

      // Now, process the frontmatter of the newly created, permanent file to remove the vc-id
      try {
        await this.app.fileManager.processFrontMatter(newFile, (fm: FrontMatterCache) => {
          delete fm[NOTE_FRONTMATTER_KEY];
        });
      } catch (fmError) {
        console.error(`VC: Failed to remove vc-id from new deviation note "${newFilePath}". Trashing the file to prevent issues.`, fmError);
        await this.app.vault.trash(newFile, true).catch((delErr) => {
          console.error(`VC: CRITICAL: Failed to trash corrupted deviation file "${newFilePath}". Please delete it manually.`, delErr);
        });
        throw new Error(`Failed to create a clean deviation. The file could not be processed after creation.`);
      }

      return newFile;
    } catch (error) {
      console.error(`VC: Failed to create deviation for note ${noteId}, version ${versionId}.`, error);
      throw error;
    } finally {
      // CRITICAL: Ensure the path is removed from the exclusion list, even if an error occurred.
      this.noteManager.removePendingDeviation(newFilePath);
    }
  }

  public async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
    if (!noteId || !versionId) {
      throw new Error('Invalid noteId or versionId for deleteVersion.');
    }
    try {
      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      if (!noteManifest || !noteManifest.versions[versionId]) {
        console.warn('VC: Version to delete not found in manifest. It may have already been deleted.');
        // If the version is not in the manifest, still try to delete the content file just in case it's an orphan.
        await this.versionContentRepo.delete(noteId, versionId);
        return true; // Return true as the desired state (version gone) is achieved.
      }

      if (Object.keys(noteManifest.versions).length === 1) {
        // This is the last version. The `deleteAllVersions` logic is now safe to call
        // as its underlying repository calls are queued.
        return this.deleteAllVersions(noteId);
      }

      // This is NOT the last version, proceed with normal deletion.
      // This manifest update is queued.
      await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
        delete manifest.versions[versionId];
        manifest.lastModified = new Date().toISOString();
      });

      // This content deletion is queued.
      await this.versionContentRepo.delete(noteId, versionId);
      this.eventBus.trigger('version-deleted', noteId);
      return true;
    } catch (error) {
      console.error(`VC: Failed to delete version ${versionId} for note ${noteId}.`, error);
      throw error;
    }
  }

  public async deleteAllVersions(noteId: string): Promise<boolean> {
    if (!noteId) {
      throw new Error('Invalid noteId for deleteAllVersions.');
    }
    try {
      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      const liveFilePath = noteManifest?.notePath;
      // This is a multi-step operation, but the critical parts inside are queued.
      await this.manifestManager.deleteNoteEntry(noteId);

      if (liveFilePath) {
        await this.cleanupFrontmatter(liveFilePath, noteId);
      }
      this.eventBus.trigger('history-deleted', noteId);
      return true;
    } catch (error) {
      console.error(`VC: Failed to delete all versions for note ${noteId}.`, error);
      throw error;
    }
  }

  private async cleanupFrontmatter(filePath: string, expectedNoteId: string): Promise<void> {
    const liveFile = this.app.vault.getAbstractFileByPath(filePath);
    if (liveFile instanceof TFile) {
      try {
        await this.app.fileManager.processFrontMatter(liveFile, (fm) => {
            // Only delete the key if it matches the one we expect, to avoid race conditions
            if (fm[NOTE_FRONTMATTER_KEY] === expectedNoteId) {
                delete fm[NOTE_FRONTMATTER_KEY];
            }
        });
      } catch (fmError) {
        console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
      }
    }
  }
}
