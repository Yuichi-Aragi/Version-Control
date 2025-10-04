import { App, TFile, MarkdownView, TFolder, type FrontMatterCache } from 'obsidian';
import { map, orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { diffLines } from 'diff';
import { ManifestManager } from './manifest-manager';
import { NoteManager } from './note-manager';
import type { VersionControlSettings, VersionHistoryEntry, BranchState, Branch } from '../types';
import { generateUniqueFilePath } from '../utils/file';
import { PluginEvents } from './plugin-events';
import { generateUniqueId } from '../utils/id';
import { VersionContentRepository } from './storage/version-content-repository';
import { TYPES } from '../types/inversify.types';
import type VersionControlPlugin from '../main';
import { DEFAULT_BRANCH_NAME } from '../constants';

/**
 * Manages the core business logic for versioning operations like saving,
 * restoring, deleting, and retrieving versions. It orchestrates other services
 * and repositories to perform its tasks, relying on them for concurrency control.
 */
@injectable()
export class VersionManager {
  constructor(
    @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.ManifestManager) private readonly manifestManager: ManifestManager,
    @inject(TYPES.NoteManager) private readonly noteManager: NoteManager,
    @inject(TYPES.VersionContentRepo) private readonly versionContentRepo: VersionContentRepository,
    @inject(TYPES.EventBus) private readonly eventBus: PluginEvents
  ) {}

  private get noteIdKey(): string {
    return this.plugin.settings.noteIdFrontmatterKey;
  }

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

    const noteId = await this.noteManager.getOrCreateNoteId(file);
    if (!noteId) {
      throw new Error('Could not get or create a note ID for the file.');
    }

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

    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    let contentToSave: string;

    if (activeMarkdownView?.file?.path === file.path) {
        contentToSave = activeMarkdownView.editor.getValue();
    } else {
        if (!(await this.app.vault.adapter.exists(file.path))) {
            throw new Error(`File to be saved does not exist at path: ${file.path}`);
        }
        contentToSave = await this.app.vault.adapter.read(file.path);
    }

    const latestContent = await this.versionContentRepo.getLatestVersionContent(noteId, noteManifest);

    if (isAuto && settings.enableMinLinesChangedCheck && latestContent !== null) {
        const changes = diffLines(latestContent, contentToSave);
        let changedLines = 0;
        for (const part of changes) {
            if (part.added || part.removed) {
                changedLines += part.count!;
            }
        }

        if (changedLines < settings.minLinesChanged) {
            return { status: 'skipped_min_lines', newVersionEntry: null, displayName: '', newNoteId: noteId };
        }
    }

    if (!force) {
      if (latestContent !== null && latestContent === contentToSave) {
        return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
      }
    }

    const versionId = generateUniqueId();

    try {
      const { size } = await this.versionContentRepo.write(noteId, versionId, contentToSave);
      const version_name = (name || '').trim();
      const timestamp = new Date().toISOString();

      const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
        const branch = manifest.branches[branchName];
        if (branch) {
            const versionNumber = (branch.totalVersions || 0) + 1;
            branch.versions[versionId] = {
              versionNumber,
              timestamp,
              size,
              ...(version_name && { name: version_name }),
            };
            branch.totalVersions = versionNumber;
            manifest.lastModified = timestamp;
        }
      });

      const savedVersionData = updatedManifest.branches[branchName]?.versions[versionId];
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
          branchName,
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
      await this.versionContentRepo.delete(noteId, versionId).catch((cleanupError) => {
        console.error(`VC: FAILED to clean up orphaned version file after an error: ${versionId}`, cleanupError);
      });
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
      const branch = manifest.branches[manifest.currentBranch];
      if (!branch) throw new Error(`Current branch not found for note ${noteId}`);
      
      const versionData = branch.versions[versionId];
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
      if (!noteManifest) return [];
      
      const branchName = noteManifest.currentBranch;
      const currentBranch = noteManifest.branches[branchName];
      if (!currentBranch || !currentBranch.versions) {
        return [];
      }

      const history = map(currentBranch.versions, (data, id) => ({
        id,
        noteId,
        notePath: noteManifest.notePath,
        branchName,
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

    this.noteManager.addPendingDeviation(newFilePath);

    try {
      const newFile = await this.app.vault.create(newFilePath, versionContent);
      if (!newFile) {
        throw new Error('Failed to create the new note file for deviation.');
      }

      try {
        await this.app.fileManager.processFrontMatter(newFile, (fm: FrontMatterCache) => {
          delete fm[this.noteIdKey];
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
      this.noteManager.removePendingDeviation(newFilePath);
    }
  }

  public async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
    if (!noteId || !versionId) {
      throw new Error('Invalid noteId or versionId for deleteVersion.');
    }
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

      if (Object.keys(branch.versions).length === 1) {
        return this.deleteBranch(noteId, branchName);
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
  }

  public async deleteAllVersionsInCurrentBranch(noteId: string): Promise<boolean> {
    if (!noteId) throw new Error('Invalid noteId for deleteAllVersionsInCurrentBranch.');
    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) return false;
    return this.deleteBranch(noteId, noteManifest.currentBranch);
  }

  private async cleanupFrontmatter(filePath: string, expectedNoteId: string): Promise<void> {
    const liveFile = this.app.vault.getAbstractFileByPath(filePath);
    if (liveFile instanceof TFile) {
      try {
        await this.app.fileManager.processFrontMatter(liveFile, (fm) => {
            if (fm[this.noteIdKey] === expectedNoteId) {
                delete fm[this.noteIdKey];
            }
        });
      } catch (fmError) {
        console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
      }
    }
  }

  // Branching logic
  public async createBranch(noteId: string, newBranchName: string): Promise<void> {
    await this.manifestManager.updateNoteManifest(noteId, manifest => {
        if (manifest.branches[newBranchName]) {
            throw new Error(`Branch "${newBranchName}" already exists.`);
        }
        const currentBranchSettings = manifest.branches[manifest.currentBranch]?.settings;
        const newBranch: Branch = {
            versions: {},
            totalVersions: 0,
        };
        if (currentBranchSettings) {
            newBranch.settings = currentBranchSettings;
        }
        manifest.branches[newBranchName] = newBranch;
    });
  }

  public async switchBranch(noteId: string, newBranchName: string): Promise<void> {
    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) throw new Error('Manifest not found');

    const currentBranchName = noteManifest.currentBranch;
    if (currentBranchName === newBranchName) return;

    // Find the MarkdownView for the current note, regardless of focus.
    let targetView: MarkdownView | null = null;
    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of markdownLeaves) {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === noteManifest.notePath) {
            targetView = leaf.view;
            break;
        }
    }

    // 1. Save current editor state to the old branch
    if (targetView) {
        const state: BranchState = {
            content: targetView.editor.getValue(),
            cursor: targetView.editor.getCursor(),
            scroll: targetView.editor.getScrollInfo()
        };
        await this.manifestManager.updateNoteManifest(noteId, manifest => {
            const branch = manifest.branches[currentBranchName];
            if (branch) {
                branch.state = state;
            }
        });
    }

    // 2. Switch branch pointer in manifest
    await this.manifestManager.updateNoteManifest(noteId, manifest => {
        if (!manifest.branches[newBranchName]) {
            throw new Error(`Branch "${newBranchName}" does not exist.`);
        }
        manifest.currentBranch = newBranchName;
    });

    // 3. Load new state into the editor
    const newManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!newManifest) throw new Error("Failed to reload manifest after switching branch.");

    const newBranch = newManifest.branches[newBranchName];
    const newBranchState = newBranch?.state;

    if (targetView) {
        if (newBranchState) {
            // A saved state exists for the new branch, restore it.
            targetView.editor.setValue(newBranchState.content);
            targetView.editor.setCursor(newBranchState.cursor);
            targetView.editor.scrollTo(newBranchState.scroll.left, newBranchState.scroll.top);
        } else {
            // No saved state. Load the content of the latest version of the new branch.
            const latestVersionContent = await this.versionContentRepo.getLatestVersionContent(noteId, newManifest);
            if (latestVersionContent !== null) {
                targetView.editor.setValue(latestVersionContent);
            }
        }
    }
  }

  public async deleteBranch(noteId: string, branchName: string): Promise<boolean> {
    if (!noteId || !branchName) throw new Error('Invalid noteId or branchName for deleteBranch.');
    
    try {
        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest || !noteManifest.branches[branchName]) {
            console.warn(`VC: Branch to delete '${branchName}' not found.`);
            return true;
        }

        if (Object.keys(noteManifest.branches).length === 1) {
            // This is the last branch. Deleting it means deleting the entire note history.
            const liveFilePath = noteManifest.notePath;
            await this.manifestManager.deleteNoteEntry(noteId);
            if (liveFilePath) {
                await this.cleanupFrontmatter(liveFilePath, noteId);
            }
            this.eventBus.trigger('history-deleted', noteId);
            return true;
        }

        const versionsToDelete = Object.keys(noteManifest.branches[branchName]?.versions ?? {});
        
        await this.manifestManager.updateNoteManifest(noteId, manifest => {
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
  }
}
