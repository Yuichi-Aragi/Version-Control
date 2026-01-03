import { transfer } from 'comlink';
import type { VersionHistoryEntry, NoteManifest } from '@/types';
import type VersionControlPlugin from '@/main';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import type { DeleteOperation } from './delete-operation';
import { StatsHelper } from '../helpers/stats-helper';
import type { QueueService } from '@/services';
import { TaskPriority } from '@/types';

// Helper for main thread hashing to ensure fast, deterministic duplicate checks
async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class CreateOperation {
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly plugin: VersionControlPlugin,
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly queueService: QueueService,
    private readonly deleteOperation: DeleteOperation
  ) {}

  /**
   * Public API: Creates a new edit.
   * Acquires lock 'edit:{noteId}' and calls internal implementation.
   */
  async createEdit(
    noteId: string,
    branchName: string,
    content: string,
    filePath: string,
    maxVersions: number
  ): Promise<{ entry: VersionHistoryEntry; deletedIds: string[] } | null> {
    return this.queueService.add(
        `edit:${noteId}`,
        () => this._createEditInternal(noteId, branchName, content, filePath, maxVersions),
        { priority: TaskPriority.HIGH }
    );
  }

  /**
   * Public API: Saves an edit.
   * Acquires lock 'edit:{noteId}' and calls internal implementation.
   */
  async saveEdit(
    noteId: string,
    branchName: string,
    editId: string,
    content: string,
    manifest: NoteManifest,
    forcePersistence = false
  ): Promise<{ size: number; contentHash: string }> {
    return this.queueService.add(
        `edit:${noteId}`,
        () => this._saveEditInternal(noteId, branchName, editId, content, manifest, forcePersistence),
        { priority: TaskPriority.HIGH }
    );
  }

  // ==================================================================================
  // INTERNAL IMPLEMENTATION (No Locking)
  // ==================================================================================

  private async _createEditInternal(
    noteId: string,
    branchName: string,
    content: string,
    filePath: string,
    maxVersions: number
  ): Promise<{ entry: VersionHistoryEntry; deletedIds: string[] } | null> {
      // 1. Get Fresh Manifest (Authoritative Source for IDB state)
      const proxy = this.workerClient.ensureWorker();
      const existingManifest = await proxy.getEditManifest(noteId);
      
      const activeBranch = branchName;
      let manifest: NoteManifest;
      
      if (!existingManifest) {
        // Case 1: Manifest does not exist.
        // Requirement: Create it before saving.
        const now = new Date().toISOString();
        manifest = {
          noteId,
          notePath: filePath,
          currentBranch: activeBranch,
          branches: {
            [activeBranch]: {
              versions: {},
              totalVersions: 0,
            },
          },
          createdAt: now,
          lastModified: now,
        };
      } else {
        // Case 2: Manifest exists.
        manifest = JSON.parse(JSON.stringify(existingManifest));
        
        // Requirement: If that branch exists in note manifest... if no then don't save.
        if (!manifest.branches[activeBranch]) {
            console.warn(`VC: Branch "${activeBranch}" not found in edit manifest for "${noteId}". Aborting save.`);
            throw new Error(`Cannot save edit: Branch "${activeBranch}" does not exist.`);
        }

        if (manifest.currentBranch !== activeBranch) {
          manifest.currentBranch = activeBranch;
        }
      }

      const branch = manifest.branches[activeBranch];
      if (!branch) {
        throw new Error(`Failed to initialize branch ${activeBranch} for note ${noteId}`);
      }
      
      // 3. Check for Duplicate Content
      const currentHash = await computeHash(content);
      const existingVersions = Object.entries(branch.versions);
      
      if (existingVersions.length > 0) {
        existingVersions.sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
        const latestEntry = existingVersions[0];
        if (latestEntry) {
          const [lastEditId, lastVersionData] = latestEntry;
          if (lastVersionData.contentHash && lastVersionData.contentHash === currentHash) {
            return null;
          }
          if (!lastVersionData.contentHash) {
             const lastContentBuffer = await proxy.getEditContent(noteId, activeBranch, lastEditId);
             if (lastContentBuffer) {
                 const lastContent = new TextDecoder().decode(lastContentBuffer);
                 if (lastContent === content) return null;
             }
          }
        }
      }

      // 4. Calculate Next Version & ID
      const existingVersionNumbers = Object.values(branch.versions).map(v => v.versionNumber);
      const maxVersion = existingVersionNumbers.length > 0 ? Math.max(...existingVersionNumbers) : 0;
      const nextVersionNumber = maxVersion + 1;
      const editId = `E${nextVersionNumber}_${Date.now()}`;
      
      // 5. Calculate Stats
      const textStats = StatsHelper.calculate(content);
      const timestamp = new Date().toISOString();
      const uncompressedSize = new Blob([content]).size;

      // 6. Prepare Manifest Update
      branch.versions[editId] = {
        versionNumber: nextVersionNumber,
        timestamp,
        size: 0,
        uncompressedSize: uncompressedSize,
        contentHash: currentHash,
        wordCount: textStats.wordCount,
        wordCountWithMd: textStats.wordCountWithMd,
        charCount: textStats.charCount,
        charCountWithMd: textStats.charCountWithMd,
        lineCount: textStats.lineCount,
        lineCountWithoutMd: textStats.lineCountWithoutMd,
      };

      // 6b. Enforce History Limit
      const deletedIds: string[] = [];
      const allVersions = Object.values(branch.versions);
      
      if (allVersions.length > maxVersions) {
        const sortedEntries = Object.entries(branch.versions).sort(([, a], [, b]) => {
          return a.versionNumber - b.versionNumber;
        });
        
        const excessCount = sortedEntries.length - maxVersions;
        if (excessCount > 0) {
          const entriesToDelete = sortedEntries.slice(0, excessCount);
          for (const [idToDelete] of entriesToDelete) {
             delete branch.versions[idToDelete];
             deletedIds.push(idToDelete);
          }
        }
      }

      branch.totalVersions = Object.keys(branch.versions).length;
      manifest.lastModified = timestamp;

      // 7. Save Edit & Manifest (Internal Call)
      const saveResult = await this._saveEditInternal(noteId, activeBranch, editId, content, manifest);

      if (branch.versions[editId]) {
          branch.versions[editId]!.size = saveResult.size;
          branch.versions[editId]!.compressedSize = saveResult.size;
          branch.versions[editId]!.contentHash = saveResult.contentHash;
      }

      // 9. Physical Cleanup
      if (deletedIds.length > 0) {
          Promise.all(deletedIds.map(id => 
              this.deleteOperation.deleteEdit(noteId, activeBranch, id)
                .catch(e => console.error(`Failed to physically delete edit ${id}`, e))
          ));
      }

      return {
        entry: {
            id: editId,
            noteId,
            notePath: filePath,
            branchName: activeBranch,
            versionNumber: nextVersionNumber,
            timestamp,
            size: saveResult.size,
            compressedSize: saveResult.size,
            uncompressedSize: uncompressedSize,
            contentHash: saveResult.contentHash,
            wordCount: textStats.wordCount,
            wordCountWithMd: textStats.wordCountWithMd,
            charCount: textStats.charCount,
            charCountWithMd: textStats.charCountWithMd,
            lineCount: textStats.lineCount,
            lineCountWithoutMd: textStats.lineCountWithoutMd,
        },
        deletedIds
      };
  }

  private async _saveEditInternal(
    noteId: string,
    branchName: string,
    editId: string,
    content: string,
    manifest: NoteManifest,
    forcePersistence = false
  ): Promise<{ size: number; contentHash: string }> {
      const proxy = this.workerClient.ensureWorker();
      
      const encoded = this.encoder.encode(content);
      const buffer = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength
      ) as ArrayBuffer;
      
      const result = await proxy.saveEdit(
        noteId,
        branchName,
        editId,
        transfer(buffer, [buffer]),
        manifest
      );

      if (forcePersistence || await this.shouldPersist(manifest, branchName)) {
          this.persistence.diskWriter.schedule(noteId, branchName);
      }
      return result;
  }

  private async shouldPersist(manifest: NoteManifest, branchName: string): Promise<boolean> {
      const globalDefaults = this.plugin.settings.editHistorySettings;
      const branch = manifest.branches[branchName];
      const perBranchSettings = branch?.settings;
      const isUnderGlobalInfluence = perBranchSettings?.isGlobal !== false;

      if (isUnderGlobalInfluence) {
          return globalDefaults.enableDiskPersistence ?? true;
      } else {
          return perBranchSettings?.enableDiskPersistence ?? globalDefaults.enableDiskPersistence ?? true;
      }
  }
}
