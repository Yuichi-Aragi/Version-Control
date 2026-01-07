import { TFile, TFolder, Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { ManifestManager, PathService, StorageService, EditHistoryManager, PluginEvents, NoteManager } from '@/core';
import type { CleanupResult } from '@/core/tasks/cleanup-manager/types';
import { retryOperation } from '@/core/tasks/cleanup-manager/scheduling';
import type VersionControlPlugin from '@/main';
import { updateFrontmatter, DELETE } from '@/utils/frontmatter';

/**
 * Handles the cleanup of orphaned data, including:
 * - Duplicate note entries for the same path
 * - Missing notes (recovery or deletion)
 * - Unregistered database folders
 * - Orphaned version files
 * 
 * DESIGN:
 * - Extremely defensive: Checks existence before every operation.
 * - Idempotent: Handles "already deleted" cases as success.
 * - Fault-tolerant: Failures in one step do not halt the entire process.
 * - Responsive: Yields to the event loop to prevent UI freezing.
 */
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
   * Executes a pipeline of independent steps. Failures in one step are logged
   * but do not prevent subsequent steps from attempting to run.
   */
  public async performDeepCleanup(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    // Helper to run steps safely
    const runStep = async (name: string, operation: () => Promise<void>) => {
      if (isDestroyed()) return;
      try {
        await operation();
      } catch (e) {
        const msg = `Cleanup Step '${name}' failed: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`VC: ${msg}`, e);
        result.errors = result.errors || [];
        result.errors.push(msg);
        result.success = false; // Mark partial failure
      }
    };

    // Step 1: Resolve Path Duplicates
    await runStep('Resolve Duplicates', () => this.resolvePathDuplicates(result, isDestroyed));

    // Step 2: Verify Paths & Recover Missing Notes
    // We pass the result object to populate recovered counts, but return the missing IDs for the next step
    let missingIds: string[] = [];
    await runStep('Verify & Recover', async () => {
        missingIds = await this.verifyAndRecoverNotes(result, isDestroyed);
    });

    // Step 3: Delete True Orphans (using the IDs identified in Step 2)
    if (missingIds.length > 0) {
        await runStep('Delete Orphans', () => this.deleteTrueOrphans(missingIds, result, isDestroyed));
    }

    // Step 4: Physical Folder Cleanup (Unregistered folders)
    await runStep('Cleanup Folders', () => this.cleanupUnregisteredFolders(result, isDestroyed));

    // Step 5: Version File Cleanup (Files inside version folders that aren't in manifest)
    await runStep('Cleanup Version Files', () => this.cleanupOrphanedVersionFiles(result, isDestroyed));
  }

  private async resolvePathDuplicates(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    // Reload manifest to ensure we have the absolute latest state
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
        // Robust Sort: Oldest createdAt wins. Handle invalid dates defensively.
        entries.sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          
          const validA = !isNaN(timeA);
          const validB = !isNaN(timeB);

          if (validA && !validB) return -1; // A is valid, B is not -> A wins (comes first)
          if (!validA && validB) return 1;  // B is valid, A is not -> B wins
          if (!validA && !validB) return a.id.localeCompare(b.id); // Both invalid -> deterministic tiebreak

          if (timeA !== timeB) return timeA - timeB; // Oldest first
          return a.id.localeCompare(b.id); // Tiebreak
        });

        const winner = entries[0];
        const losers = entries.slice(1);

        if (winner) {
            console.log(`VC: Resolving duplicates for "${path}". Winner: ${winner.id}. Losers: ${losers.map(l => l.id).join(', ')}`);

            for (const loser of losers) {
              if (isDestroyed()) return;
              
              // Idempotent deletion
              await this.deleteNoteData(loser.id);
              
              // Attempt to remove loser ID from frontmatter if the file exists
              // We catch errors here specifically to not stop the loop
              try {
                  const file = this.app.vault.getAbstractFileByPath(path);
                  if (file instanceof TFile && file.extension === 'md') {
                     await this.removeIdFromFrontmatter(file, loser.id);
                  }
              } catch (e) {
                  console.warn(`VC: Failed to remove loser ID ${loser.id} from frontmatter of ${path}`, e);
              }
    
              result.deletedDuplicates++;
            }
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
      // Defensive check for entry validity
      if (!entry || !entry.notePath) continue;

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
      if (isDestroyed()) return Array.from(missingIdSet);
      
      const chunk = allFiles.slice(i, i + chunkSize);
      
      for (const file of chunk) {
        try {
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
              
              // Update Manifests - Defensive calls
              await this.manifestManager.updateNotePath(foundId, file.path).catch(e => console.error(`VC: Failed to update path for ${foundId}`, e));
              await this.editHistoryManager.updateNotePath(foundId, file.path).catch(e => console.error(`VC: Failed to update edit history path for ${foundId}`, e));
              
              missingIdSet.delete(foundId);
              result.recoveredNotes++;
            }
        } catch (e) {
            // Individual file scan error should not abort the whole scan
            console.debug(`VC: Error scanning file ${file.path} for recovery`, e);
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
      try {
          console.log(`VC: Deleting true orphan note data: ${id}`);
          await this.deleteNoteData(id);
          result.deletedOrphans++;
      } catch (e) {
          console.error(`VC: Failed to delete orphan ${id}`, e);
          result.errors = result.errors || [];
          result.errors.push(`Failed to delete orphan ${id}: ${e}`);
      }
    }
  }

  private async cleanupUnregisteredFolders(
    result: CleanupResult,
    isDestroyed: () => boolean
  ): Promise<void> {
    const centralManifest = await this.manifestManager.loadCentralManifest(true);
    const validNoteIds = new Set(Object.keys(centralManifest.notes));

    const dbRootPath = this.pathService.getDbRoot();
    
    // Defensive: Verify root exists and is a folder
    let dbRootFolder = this.app.vault.getAbstractFileByPath(dbRootPath);
    if (!dbRootFolder) {
        // If it doesn't exist in cache, check adapter directly
        if (await this.app.vault.adapter.exists(dbRootPath)) {
             // It exists but not in cache? Rare.
             // We can't safely iterate children if not in cache via TFolder API easily without adapter.list
        }
        return;
    }
    
    if (!(dbRootFolder instanceof TFolder)) {
      return;
    }

    // Use a copy of children to avoid modification issues during iteration
    const childrenCopy = [...dbRootFolder.children];
    
    for (const noteDir of childrenCopy) {
      if (isDestroyed()) return;
      
      // Strict Type Check
      if (!(noteDir instanceof TFolder)) continue;

      const noteId = noteDir.name;
      
      // Safety Check: Ensure we don't delete system folders or the root itself (though we are iterating children)
      // Also check if the name looks vaguely like an ID to avoid deleting user folders if they mapped DB to root (user error, but still)
      if (!this.isValidNoteId(noteId)) continue;

      // If folder name is a valid ID format but NOT in the manifest, it's an orphan
      if (!validNoteIds.has(noteId)) {
        try {
            await retryOperation(
              () => this.storageService.permanentlyDeleteFolder(noteDir.path),
              `Failed to delete orphaned note directory: ${noteDir.path}`
            );
            result.deletedNoteDirs++;
        } catch (e) {
            // Log but continue
            console.warn(`VC: Could not delete orphaned folder ${noteDir.path}`, e);
        }
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

      try {
          const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
          if (!noteManifest) {
            // If manifest is missing, the whole folder might be corrupt or missing.
            // We skip file-level cleanup here; folder-level cleanup (if ID was invalid) would have caught it,
            // but since ID is valid, we leave it for now to avoid deleting data that might be recoverable.
            continue;
          }
    
          const allValidVersionIds = new Set<string>();
          if (noteManifest.branches) {
              for (const branchName in noteManifest.branches) {
                const branch = noteManifest.branches[branchName];
                if (branch?.versions) {
                  Object.keys(branch.versions).forEach(id => allValidVersionIds.add(id));
                }
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
              
              // Only delete if we parsed a valid ID and it's NOT in the manifest
              if (versionId && !allValidVersionIds.has(versionId)) {
                await this.safeDeleteFile(versionFile.path);
                result.deletedVersionFiles++;
              }
            }
          }
      } catch (e) {
          console.warn(`VC: Error cleaning up version files for note ${noteId}`, e);
      }
    }
  }

  // --- Helpers ---

  /**
   * Safely deletes a file, treating "not found" as success.
   */
  private async safeDeleteFile(path: string): Promise<void> {
      try {
          const exists = await this.app.vault.adapter.exists(path);
          if (!exists) return;
          await this.app.vault.adapter.remove(path);
      } catch (e) {
          // Double check existence to confirm if it was a race condition
          const stillExists = await this.app.vault.adapter.exists(path);
          if (stillExists) {
              throw e;
          }
      }
  }

  private async deleteNoteData(noteId: string): Promise<void> {
    try {
      // 1. Remove from Central Manifest (and physical folder via ManifestManager)
      // Note: ManifestManager.deleteNoteEntry handles both central manifest removal and physical folder deletion
      // It is robust against missing entries.
      await this.manifestManager.deleteNoteEntry(noteId);

      // 2. Delete Edit History (IDB)
      // This is robust against missing keys.
      await this.editHistoryManager.deleteNoteHistory(noteId);

      // 3. Clear Timeline & Notify
      this.eventBus.trigger('history-deleted', noteId);
      
      // 4. Invalidate Caches
      this.manifestManager.invalidateNoteManifestCache(noteId);
    } catch (e) {
      console.error(`VC: Failed to delete data for note ${noteId}`, e);
      throw e; // Propagate to caller for logging
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
    // Basic sanity check to ensure we don't touch paths that are clearly not IDs
    return typeof noteId === 'string' && 
           noteId.length > 0 && 
           !noteId.includes('/') && 
           !noteId.includes('\\') && 
           !noteId.includes('..');
  }
}
