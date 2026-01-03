import { TFile, TFolder, Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { ManifestManager, PathService, StorageService, EditHistoryManager, PluginEvents, NoteManager } from '@/core';
import type { CleanupResult } from '@/core/tasks/cleanup-manager/types';
import { retryOperation } from '@/core/tasks/cleanup-manager/scheduling';
import type VersionControlPlugin from '@/main';
import { updateFrontmatter, DELETE } from '@/utils/frontmatter';

export class OrphanCleanupOperation {
  constructor(
    private readonly app: App,
    private readonly manifestManager: ManifestManager,
    private readonly editHistoryManager: EditHistoryManager,
    private readonly pathService: PathService,
    private readonly storageService: StorageService,
    private readonly eventBus: PluginEvents,
    private readonly plugin: VersionControlPlugin,
    private readonly noteManager: NoteManager
  ) {}

  /**
   * Performs a comprehensive, deep cleanup of the version control data.
   * 1. Resolves duplicate NoteIDs pointing to the same path (keeps oldest).
   * 2. Verifies physical file existence for all NoteIDs.
   * 3. Scans vault frontmatter to recover "missing" notes that were moved outside Obsidian.
   * 4. Deletes data for true orphans (missing and not recoverable).
   * 5. Cleans up physical .versiondb folders that have no manifest entry.
   */
  public async performDeepCleanup(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    // Step 1: Resolve Path Duplicates
    await this.resolvePathDuplicates(result, isDestroyed);
    if (isDestroyed()) return;

    // Step 2: Verify Paths & Recover Missing Notes
    const missingIds = await this.verifyAndRecoverNotes(result, isDestroyed);
    if (isDestroyed()) return;

    // Step 3: Delete True Orphans
    await this.deleteTrueOrphans(missingIds, result, isDestroyed);
    if (isDestroyed()) return;

    // Step 4: Physical Folder Cleanup (Unregistered folders)
    await this.cleanupUnregisteredFolders(result, isDestroyed);
    if (isDestroyed()) return;

    // Step 5: Version File Cleanup (Files inside version folders that aren't in manifest)
    await this.cleanupOrphanedVersionFiles(result, isDestroyed);
  }

  private async resolvePathDuplicates(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const pathToIds = new Map<string, { id: string; createdAt: string }[]>();

    // Group IDs by Path
    for (const [id, entry] of Object.entries(centralManifest.notes)) {
      if (!entry) continue;
      if (!pathToIds.has(entry.notePath)) {
        pathToIds.set(entry.notePath, []);
      }
      pathToIds.get(entry.notePath)!.push({ id, createdAt: entry.createdAt });
    }

    // Resolve duplicates
    for (const [path, entries] of pathToIds) {
      if (isDestroyed()) return;

      if (entries.length > 1) {
        // Sort by createdAt ascending (oldest first)
        // If createdAt is invalid/same, sort by ID for determinism
        entries.sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        const winner = entries[0];
        const losers = entries.slice(1);

        console.log(`VC: Resolving duplicates for "${path}". Winner: ${winner?.id}. Losers: ${losers.map(l => l.id).join(', ')}`);

        for (const loser of losers) {
          await this.deleteNoteData(loser.id);
          
          // Attempt to remove loser ID from frontmatter if the file exists
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile && file.extension === 'md') {
             await this.removeIdFromFrontmatter(file, loser.id);
          }

          result.deletedDuplicates++;
        }
      }
    }
  }

  private async verifyAndRecoverNotes(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<string[]> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const missingIds: string[] = [];

    // Identify Missing Notes
    for (const [id, entry] of Object.entries(centralManifest.notes)) {
      const file = this.app.vault.getAbstractFileByPath(entry.notePath);
      if (!file) {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) return [];

    console.log(`VC: Found ${missingIds.length} missing notes. Scanning vault for recovery...`);

    // Scan Vault to Recover
    const allFiles = this.app.vault.getMarkdownFiles();
    const noteIdKey = this.plugin.settings.noteIdFrontmatterKey;
    const legacyKeys = this.plugin.settings.legacyNoteIdFrontmatterKeys || [];

    // Batch processing to avoid freezing UI
    const chunkSize = Platform.isMobile ? 50 : 500;
    const missingIdSet = new Set(missingIds);

    for (let i = 0; i < allFiles.length; i += chunkSize) {
      if (isDestroyed()) return missingIds;
      
      const chunk = allFiles.slice(i, i + chunkSize);
      
      for (const file of chunk) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) continue;

        let foundId: string | null = null;
        
        // Check primary key
        if (cache.frontmatter[noteIdKey] && missingIdSet.has(cache.frontmatter[noteIdKey])) {
          foundId = cache.frontmatter[noteIdKey];
        } 
        // Check legacy keys
        else {
          for (const key of legacyKeys) {
            if (cache.frontmatter[key] && missingIdSet.has(cache.frontmatter[key])) {
              foundId = cache.frontmatter[key];
              break;
            }
          }
        }

        if (foundId) {
          console.log(`VC: Recovered missing note ${foundId} at "${file.path}"`);
          
          // Update Manifests
          await this.manifestManager.updateNotePath(foundId, file.path);
          await this.editHistoryManager.updateNotePath(foundId, file.path);
          
          missingIdSet.delete(foundId);
          result.recoveredNotes++;
        }
      }

      // Yield to UI loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return Array.from(missingIdSet);
  }

  private async deleteTrueOrphans(
    missingIds: string[],
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    for (const id of missingIds) {
      if (isDestroyed()) return;
      console.log(`VC: Deleting true orphan note data: ${id}`);
      await this.deleteNoteData(id);
      result.deletedOrphans++;
    }
  }

  private async cleanupUnregisteredFolders(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys(centralManifest.notes));

    const dbRootPath = this.pathService.getDbRoot();
    const dbRootFolder = this.app.vault.getAbstractFileByPath(dbRootPath);

    if (!(dbRootFolder instanceof TFolder)) {
      return;
    }

    const childrenCopy = [...dbRootFolder.children];
    for (const noteDir of childrenCopy) {
      if (isDestroyed()) return;
      if (!(noteDir instanceof TFolder)) continue;

      const noteId = noteDir.name;
      // If folder name looks like a note ID but isn't in manifest, delete it
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
    const validNoteIds = new Set(Object.keys(centralManifest.notes));

    for (const noteId of validNoteIds) {
      if (isDestroyed()) break;

      const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
      if (!noteManifest) {
        // If note manifest is missing but central has it, it might be a partial state.
        // We skip for now, or we could consider it corrupt.
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

      if (!(versionsFolder instanceof TFolder)) continue;

      const childrenCopy = [...versionsFolder.children];
      for (const versionFile of childrenCopy) {
        if (isDestroyed()) break;
        if (!(versionFile instanceof TFile)) continue;

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

  // --- Helpers ---

  private async deleteNoteData(noteId: string): Promise<void> {
    try {
      // 1. Remove from Central Manifest (and physical folder via ManifestManager)
      // Note: ManifestManager.deleteNoteEntry handles both central manifest removal and physical folder deletion
      await this.manifestManager.deleteNoteEntry(noteId);

      // 2. Delete Edit History (IDB)
      await this.editHistoryManager.deleteNoteHistory(noteId);

      // 3. Clear Timeline & Notify
      this.eventBus.trigger('history-deleted', noteId);
      
      // 4. Invalidate Caches
      this.manifestManager.invalidateNoteManifestCache(noteId);
    } catch (e) {
      console.error(`VC: Failed to delete data for note ${noteId}`, e);
    }
  }

  private async removeIdFromFrontmatter(file: TFile, idToRemove: string): Promise<void> {
    const noteIdKey = this.plugin.settings.noteIdFrontmatterKey;
    const legacyKeys = this.plugin.settings.legacyNoteIdFrontmatterKeys || [];

    const cache = this.app.metadataCache.getFileCache(file);
    const updates: Record<string, any> = {};
    let needsUpdate = false;

    if (cache?.frontmatter?.[noteIdKey] === idToRemove) {
      updates[noteIdKey] = DELETE;
      needsUpdate = true;
    }

    for (const key of legacyKeys) {
      if (cache?.frontmatter?.[key] === idToRemove) {
        updates[key] = DELETE;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      // IGNORE INTERNAL WRITE: Prevent metadata change loop
      this.noteManager.registerInternalWrite(file.path);
      await updateFrontmatter(this.app, file, updates);
    }
  }

  private isValidNoteId(noteId: string): boolean {
    return typeof noteId === 'string' && noteId.length > 0 && !noteId.includes('..');
  }
}
