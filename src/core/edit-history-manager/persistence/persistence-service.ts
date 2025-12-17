import { App } from 'obsidian';
import { transfer } from 'comlink';
import type { PathService } from '@/core';
import type { NoteManifest } from '@/types';
import { DebouncedDiskWriter } from '../infrastructure/disk-writer';
import { EditHistoryError } from '../infrastructure/error';
import { withRetry } from '../infrastructure/retry';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { ScheduledWrite } from '../types';

const SAVE_DEBOUNCE_MS = 2000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

export class PersistenceService {
  public readonly diskWriter: DebouncedDiskWriter;

  constructor(
    private readonly app: App,
    private readonly pathService: PathService,
    private readonly workerClient: WorkerClient
  ) {
    this.diskWriter = new DebouncedDiskWriter(
      this.persistBranchToDiskInternal.bind(this),
      SAVE_DEBOUNCE_MS
    );
  }

  async loadBranchFromDisk(noteId: string, branchName: string): Promise<void> {
    // 1. Ensure any pending writes are flushed (best effort to sync DB to disk before we potentially overwrite)
    await this.diskWriter.flush(noteId, branchName);

    const proxy = this.workerClient.ensureWorker();

    // 2. Get DB State
    const dbManifest = await proxy.getEditManifest(noteId);
    let dbTimestamp = 0;
    
    if (dbManifest && dbManifest.branches[branchName]) {
        const branch = dbManifest.branches[branchName];
        if (branch.versions) {
            const timestamps = Object.values(branch.versions).map(v => new Date(v.timestamp).getTime());
            if (timestamps.length > 0) {
                dbTimestamp = Math.max(...timestamps);
            }
        }
    }

    // 3. Check File State
    const branchPath = this.pathService.getBranchPath(noteId, branchName);
    const exists = await this.app.vault.adapter.exists(branchPath);

    if (!exists) {
        // File missing. If DB has data, export it.
        if (dbTimestamp > 0) {
            console.log(`VC: .vctrl missing for ${noteId}/${branchName}, exporting from DB.`);
            this.diskWriter.schedule(noteId, branchName);
        }
        return;
    }

    // Find newest .vctrl file
    const result = await this.app.vault.adapter.list(branchPath);
    const vctrlFiles = result.files.filter(f => f.endsWith('.vctrl')).sort();
    const newestFile = vctrlFiles[vctrlFiles.length - 1];

    if (!newestFile) {
         if (dbTimestamp > 0) this.diskWriter.schedule(noteId, branchName);
         return;
    }

    // 4. Read File Manifest
    let fileData: ArrayBuffer;
    let fileManifest: any;
    let fileTimestamp = 0;

    try {
        fileData = await withRetry(
            () => this.app.vault.adapter.readBinary(newestFile),
            MAX_RETRY_ATTEMPTS,
            RETRY_BASE_DELAY_MS
        );
        
        // Peek at manifest without full import
        // We clone the buffer for the peek because transfer detaches it, but we might need it for import later
        fileManifest = await proxy.readManifestFromZip(transfer(fileData.slice(0), [fileData.slice(0)]));
        fileTimestamp = Date.parse(fileManifest.exportedAt);

    } catch (e) {
        console.warn(`VC: Corrupt .vctrl file found: ${newestFile}`, e);
        // Corrupt file.
        if (dbTimestamp > 0) {
            // DB has data, overwrite file
            console.log(`VC: Overwriting corrupt file with DB data.`);
            this.diskWriter.schedule(noteId, branchName);
        }
        // If DB empty and File corrupt, we can't do anything.
        return;
    }

    // 5. Compare and Sync
    // "Always refetch... overwrite... on context change" -> Bias towards Import.
    // "Utilise timestamps" -> Handle stale file case if DB is strictly newer.

    // If File is newer or equal, or if we just default to File as Truth (as requested):
    if (fileTimestamp >= dbTimestamp) {
        // Import File to DB
        await proxy.importBranchData(
            noteId,
            branchName,
            transfer(fileData, [fileData])
        );
    } else {
        // DB is strictly newer -> Export DB to File
        console.log(`VC: DB is newer (${new Date(dbTimestamp).toISOString()}) than File (${new Date(fileTimestamp).toISOString()}). Exporting DB.`);
        this.diskWriter.schedule(noteId, branchName);
    }
  }

  private async persistBranchToDiskInternal(write: ScheduledWrite): Promise<void> {
    const { noteId, branchName, sequence, retryCount } = write;
    
    if (!this.workerClient.isAvailable()) {
      throw new EditHistoryError('Worker unavailable during persistence', 'WORKER_UNAVAILABLE');
    }

    try {
      const proxy = this.workerClient.ensureWorker();
      const zipBuffer = await proxy.exportBranchData(noteId, branchName);
      
      if (zipBuffer.byteLength === 0) return;

      const branchPath = this.pathService.getBranchPath(noteId, branchName);

      const folderExists = await this.app.vault.adapter.exists(branchPath);
      if (!folderExists) {
        await this.app.vault.adapter.mkdir(branchPath);
      }

      const timestamp = Date.now();
      const filename = this.pathService.getVctrlFilename(
        `${timestamp}_${sequence.toString().padStart(6, '0')}`
      );
      const newFilePath = `${branchPath}/${filename}`;

      await withRetry(
        () => this.app.vault.adapter.writeBinary(newFilePath, zipBuffer),
        MAX_RETRY_ATTEMPTS,
        RETRY_BASE_DELAY_MS
      );

      const verifyBuffer = await this.app.vault.adapter.readBinary(newFilePath);
      if (verifyBuffer.byteLength !== zipBuffer.byteLength) {
        throw new EditHistoryError(
          'File size mismatch during integrity check',
          'INTEGRITY_CHECK_FAILED',
          { noteId, branchName, expected: zipBuffer.byteLength, actual: verifyBuffer.byteLength }
        );
      }

      const result = await this.app.vault.adapter.list(branchPath);
      const oldFiles = result.files.filter(
        (f): f is string => f.endsWith('.vctrl') && f !== newFilePath
      );

      for (const oldFile of oldFiles) {
        try {
          await this.app.vault.adapter.remove(oldFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      if (retryCount < MAX_RETRY_ATTEMPTS - 1) {
        this.diskWriter.schedule(noteId, branchName);
        throw error;
      }
      
      throw new EditHistoryError(
        `Failed to persist branch ${branchName} to disk for note ${noteId}`,
        'DISK_WRITE_FAILED',
        { noteId, branchName, sequence },
        error
      );
    }
  }

  shutdown(): void {
    this.diskWriter.cancelAll();
  }
}
