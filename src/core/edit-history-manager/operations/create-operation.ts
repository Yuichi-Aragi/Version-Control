import { transfer } from 'comlink';
import { produce } from 'immer';
import type { VersionHistoryEntry, NoteManifest } from '@/types';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { PersistenceService } from '../persistence/persistence-service';
import type { AtomicOperationCoordinator } from '../infrastructure/coordinator';
import type { LockManager } from '../infrastructure/lock-manager';
import type { ReadOperation } from './read-operation';
import type { DeleteOperation } from './delete-operation';
import { StatsHelper } from '../helpers/stats-helper';

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
    private readonly workerClient: WorkerClient,
    private readonly persistence: PersistenceService,
    private readonly coordinator: AtomicOperationCoordinator,
    private readonly lockManager: LockManager,
    private readonly readOperation: ReadOperation,
    private readonly deleteOperation: DeleteOperation
  ) {}

  async createEdit(
    noteId: string,
    content: string,
    filePath: string,
    maxVersions: number
  ): Promise<{ entry: VersionHistoryEntry; deletedIds: string[] } | null> {
    // STRICT SERIALIZATION: Ensure only one create operation happens per note at a time
    return this.lockManager.runSerialized(noteId, async () => {
      // 1. Get Fresh Manifest (Authoritative Source)
      // We must fetch the manifest INSIDE the lock to ensure we are building upon the latest state.
      const existingManifest = await this.readOperation.getEditManifest(noteId);
      const activeBranch = existingManifest?.currentBranch || 'main';

      // 2. Initialize or Clone Manifest
      // We use immer's produce pattern implicitly by creating a new object structure if needed,
      // or cloning the existing one to avoid mutating shared state on failure.
      let manifest: NoteManifest;
      
      if (!existingManifest) {
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
        // Deep clone to ensure isolation
        manifest = JSON.parse(JSON.stringify(existingManifest));
        
        if (manifest.currentBranch !== activeBranch) {
          manifest.currentBranch = activeBranch;
        }
        if (!manifest.branches[activeBranch]) {
          manifest.branches[activeBranch] = { versions: {}, totalVersions: 0 };
        }
      }

      const branch = manifest.branches[activeBranch];
      if (!branch) {
        throw new Error(`Failed to initialize branch ${activeBranch} for note ${noteId}`);
      }
      
      // 3. Check for Duplicate Content (Idempotency Check)
      const currentHash = await computeHash(content);
      
      const existingVersions = Object.entries(branch.versions);
      if (existingVersions.length > 0) {
        // Sort by version number desc to find the head
        existingVersions.sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
        
        const latestEntry = existingVersions[0];
        if (latestEntry) {
          const [lastEditId, lastVersionData] = latestEntry;
          
          // Primary Check: Content Hash (Fast & Deterministic)
          if (lastVersionData.contentHash && lastVersionData.contentHash === currentHash) {
            return null; // Absolute Idempotency: Content is identical to head
          }
          
          // Fallback Check: Content Comparison (Legacy data support)
          if (!lastVersionData.contentHash) {
             const lastContent = await this.readOperation.getEditContent(noteId, lastEditId, activeBranch);
             if (lastContent === content) {
               return null;
             }
          }
        }
      }

      // 4. Calculate Next Version & ID
      const existingVersionNumbers = Object.values(branch.versions).map(v => v.versionNumber);
      const maxVersion = existingVersionNumbers.length > 0 ? Math.max(...existingVersionNumbers) : 0;
      const nextVersionNumber = maxVersion + 1;
      
      // Deterministic ID generation based on version number to help with debugging/tracing
      const editId = `E${nextVersionNumber}_${Date.now()}`;
      
      // 5. Calculate Stats
      const textStats = StatsHelper.calculate(content);
      const timestamp = new Date().toISOString();
      const uncompressedSize = new Blob([content]).size;

      // 6. Prepare Manifest Update
      // We optimistically update the manifest in memory to pass to the worker.
      // The worker will perform the atomic write of both the edit blob and this manifest.
      branch.versions[editId] = {
        versionNumber: nextVersionNumber,
        timestamp,
        size: 0, // Placeholder, updated by worker result
        uncompressedSize: uncompressedSize,
        contentHash: currentHash,
        wordCount: textStats.wordCount,
        wordCountWithMd: textStats.wordCountWithMd,
        charCount: textStats.charCount,
        charCountWithMd: textStats.charCountWithMd,
        lineCount: textStats.lineCount,
        lineCountWithoutMd: textStats.lineCountWithoutMd,
      };

      // 6b. Enforce History Limit (Logical Cleanup)
      // We remove old edits from the manifest *before* saving.
      // This ensures the manifest written to disk/DB is already clean.
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

      // 7. Save Edit & Manifest (Atomic in Worker)
      // This is the critical point of failure. If this fails, our local `manifest` variable is discarded
      // and no harm is done to the system state.
      const saveResult = await this.saveEdit(noteId, activeBranch, editId, content, manifest);

      // 8. Update local manifest copy with returned stats (compressed size)
      if (branch.versions[editId]) {
          branch.versions[editId]!.size = saveResult.size;
          branch.versions[editId]!.compressedSize = saveResult.size;
          branch.versions[editId]!.contentHash = saveResult.contentHash;
      }

      // 9. Physical Cleanup (Async)
      // Logical deletion happened via manifest update in step 7.
      // Now we just need to clean up the blobs. We can do this asynchronously.
      // We use `deleteEdit` which does NOT acquire the note lock (it uses coordinator),
      // so it is safe to call from here.
      if (deletedIds.length > 0) {
          (async () => {
             for (const id of deletedIds) {
               try {
                 await this.deleteOperation.deleteEdit(noteId, activeBranch, id);
               } catch (e) {
                 console.error(`Failed to physically delete edit ${id}`, e);
               }
             }
          })();
      }

      // 10. Return Entry and Deleted IDs
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
    });
  }

  async saveEdit(
    noteId: string,
    branchName: string,
    editId: string,
    content: string,
    manifest: NoteManifest
  ): Promise<{ size: number; contentHash: string }> {
    const operationId = `save:${noteId}:${branchName}:${editId}`;
    const key = `${noteId}:${branchName}`;
    
    // Coordinator tracks the operation but LockManager ensures serialization
    await this.coordinator.beginAtomicOperation(key, operationId);

    try {
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

      // Schedule disk persistence
      this.persistence.diskWriter.schedule(noteId, branchName);
      return result;
    } finally {
      this.coordinator.completeAtomicOperation(key, operationId);
    }
  }
}
