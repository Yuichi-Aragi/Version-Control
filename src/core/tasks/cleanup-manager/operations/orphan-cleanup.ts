import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ManifestManager, PathService, StorageService } from '@/core';
import type { CleanupResult, CentralManifest } from '@/core/tasks/cleanup-manager/types';
import { retryOperation } from '@/core/tasks/cleanup-manager/scheduling';

export class OrphanCleanupOperation {
  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly pathService: PathService,
    private readonly storageService: StorageService
  ) {}

  public async cleanupOrphanedNoteHistories(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys((centralManifest as CentralManifest)?.notes || {}));

    const dbRootPath = this.pathService.getDbRoot();
    const dbRootFolder = this.app.vault.getAbstractFileByPath(dbRootPath);

    if (!(dbRootFolder instanceof TFolder)) {
      return;
    }

    const childrenCopy = [...dbRootFolder.children];
    for (const noteDir of childrenCopy) {
      if (!(noteDir instanceof TFolder) || isDestroyed()) {
        continue;
      }

      const noteId = noteDir.name;
      if (this.isValidNoteId(noteId) && !validNoteIds.has(noteId)) {
        await retryOperation(
          () => this.storageService.permanentlyDeleteFolder(noteDir.path),
          `Failed to delete orphaned note directory: ${noteDir.path}`
        );
        result.deletedNoteDirs++;
      }
    }
  }

  public async cleanupOrphanedVersionFiles(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys((centralManifest as CentralManifest)?.notes || {}));

    for (const noteId of validNoteIds) {
      if (isDestroyed()) {
        break;
      }

      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      if (!noteManifest) {
        console.warn(`VC: Note ID ${noteId} is in central manifest but its own manifest is missing.`);
        continue;
      }

      const allValidVersionIds = new Set<string>();
      for (const branchName in noteManifest.branches) {
        const branch = noteManifest.branches[branchName];
        if (branch?.versions) {
          Object.keys(branch.versions).forEach(id => allValidVersionIds.add(id));
        }
      }

      const versionsPath = this.pathService.getNoteVersionsPath(noteId);
      const versionsFolder = this.app.vault.getAbstractFileByPath(versionsPath);

      if (!(versionsFolder instanceof TFolder)) {
        continue;
      }

      const childrenCopy = [...versionsFolder.children];
      for (const versionFile of childrenCopy) {
        if (!(versionFile instanceof TFile) || isDestroyed()) {
          continue;
        }

        const fileName = versionFile.name;
        if (fileName?.endsWith('.md')) {
          const versionId = fileName.slice(0, -3);
          if (versionId && !allValidVersionIds.has(versionId)) {
            await retryOperation(
              () => this.app.vault.adapter.remove(versionFile.path),
              `Failed to delete orphaned version file: ${versionFile.path}`
            );
            result.deletedVersionFiles++;
          }
        }
      }
    }
  }

  private isValidNoteId(noteId: string): boolean {
    return typeof noteId === 'string' && noteId.length > 0 && !noteId.includes('..');
  }
}
