import { orderBy } from 'es-toolkit';
import { map } from 'es-toolkit/compat';
import type { NoteManifest, VersionHistoryEntry } from '@/types';
import type { WorkerClient } from '../infrastructure/worker-client';

export class ReadOperation {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly workerClient: WorkerClient) {}

  async getEditContent(noteId: string, editId: string, branchName?: string): Promise<string | null> {
    const proxy = this.workerClient.ensureWorker();

    let targetBranch = branchName;
    
    if (targetBranch === undefined) {
      const manifest = await this.getEditManifest(noteId);
      if (manifest === null) return null;
      
      for (const [bName, branch] of Object.entries(manifest.branches)) {
        if (branch.versions[editId] !== undefined) {
          targetBranch = bName;
          break;
        }
      }
    }

    if (targetBranch === undefined) return null;

    const buffer = await proxy.getEditContent(noteId, targetBranch, editId);
    if (buffer === null) return null;

    return this.decoder.decode(buffer);
  }

  async getEditManifest(noteId: string): Promise<NoteManifest | null> {
    const proxy = this.workerClient.ensureWorker();
    // This call is routed to the worker which uses a KeyedMutex.
    // This ensures that if a write is in progress for this noteId,
    // this read will wait until the write completes, preventing stale reads.
    return proxy.getEditManifest(noteId);
  }

  async getEditHistory(noteId: string): Promise<VersionHistoryEntry[]> {
    const manifest = await this.getEditManifest(noteId);
    if (manifest === null) return [];

    const branchName = manifest.currentBranch;
    const currentBranch = manifest.branches[branchName];
    
    if (currentBranch === undefined || currentBranch.versions === undefined) {
      return [];
    }

    const history = map(currentBranch.versions, (data, id) => ({
      id,
      noteId,
      notePath: manifest.notePath,
      branchName,
      versionNumber: data.versionNumber,
      timestamp: data.timestamp,
      size: data.size,
      compressedSize: data.compressedSize,
      uncompressedSize: data.uncompressedSize,
      contentHash: data.contentHash,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      wordCount: data.wordCount,
      wordCountWithMd: data.wordCountWithMd,
      charCount: data.charCount,
      charCountWithMd: data.charCountWithMd,
      lineCount: data.lineCount,
      lineCountWithoutMd: data.lineCountWithoutMd,
    }));

    return orderBy(history, ['versionNumber'], ['desc']);
  }
}
