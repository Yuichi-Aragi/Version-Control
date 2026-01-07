import { App } from 'obsidian';
import { transfer } from 'comlink';
import type { PathService } from '@/core';
import type VersionControlPlugin from '@/main';
import { DebouncedDiskWriter } from '../infrastructure/disk-writer';
import { EditHistoryError } from '../infrastructure/error';
import { withRetry } from '../infrastructure/retry';
import type { WorkerClient } from '../infrastructure/worker-client';
import type { ScheduledWrite } from '../types';

const SAVE_DEBOUNCE_MS = 5000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

interface BranchFile {
    path: string;
    timestamp: number;
    isLegacyName: boolean;
}

interface ZipManifest {
    exportedAt?: string;
    [key: string]: unknown;
}

export class PersistenceService {
  public readonly diskWriter: DebouncedDiskWriter;

  constructor(
    private readonly app: App,
    private readonly pathService: PathService,
    private readonly workerClient: WorkerClient,
    private readonly plugin: VersionControlPlugin
  ) {
    this.diskWriter = new DebouncedDiskWriter(
      this.persistBranchToDiskInternal.bind(this),
      SAVE_DEBOUNCE_MS
    );
  }

  async loadBranchFromDisk(noteId: string, branchName: string): Promise<void> {
    // 1. Ensure any pending writes are flushed to avoid race conditions
    await this.diskWriter.flush(noteId, branchName);

    const proxy = this.workerClient.ensureWorker();

    // 2. Get DB State
    const dbManifest = await proxy.getEditManifest(noteId);
    let dbTimestamp = 0;
    
    if (dbManifest) {
        dbTimestamp = new Date(dbManifest.lastModified).getTime();
    }

    // 3. Scan File System
    const branchPath = this.pathService.getBranchPath(noteId, branchName);
    const exists = await this.app.vault.adapter.exists(branchPath);

    if (!exists) {
        // File missing. If DB has data, check if we should export.
        if (dbTimestamp > 0) {
            const shouldExport = await this.shouldPersist(noteId, branchName);
            if (shouldExport) {
                console.log(`VC: .vctrl missing for ${noteId}/${branchName}, exporting from DB.`);
                this.diskWriter.schedule(noteId, branchName);
            }
        }
        return;
    }

    // 4. Identify Branch Files
    const result = await this.app.vault.adapter.list(branchPath);
    const vctrlFiles = result.files.filter(f => f.endsWith('.vctrl'));
    
    if (vctrlFiles.length === 0) {
         if (dbTimestamp > 0) {
             const shouldExport = await this.shouldPersist(noteId, branchName);
             if (shouldExport) this.diskWriter.schedule(noteId, branchName);
         }
         return;
    }

    // 5. Determine Newest File
    // If > 1 file, explicitly read all to resolve conflicts accurately.
    // If 1 file, trust filename if it matches pattern.
    const branchFiles: BranchFile[] = [];
    const filenameRegex = /^(\d+)(?:_(.+))?\.vctrl$/;
    const forceRead = vctrlFiles.length > 1;

    for (const filePath of vctrlFiles) {
        const parts = filePath.split('/');
        const name = parts.pop() ?? ''; // Ensure name is string
        if (!name) continue;

        const match = name.match(filenameRegex);
        let ts = 0;
        let isLegacy = false;

        if (forceRead || !match) {
            // Explicitly read file content for timestamp
            try {
                const fileData = await this.app.vault.adapter.readBinary(filePath);
                // Cast to ZipManifest to satisfy TS
                const manifest = await proxy.readManifestFromZip(transfer(fileData, [fileData])) as ZipManifest | null;
                
                // FIX: Extract to a variable to ensure proper type narrowing
                const exportedAt = manifest?.exportedAt;
                if (exportedAt) {
                    ts = new Date(exportedAt).getTime();
                } else {
                    // Fallback to file modification time if zip metadata is missing
                    const stat = await this.app.vault.adapter.stat(filePath);
                    ts = stat?.mtime || 0;
                }
                isLegacy = true;
            } catch (e) {
                console.warn(`VC: Failed to read metadata from potentially corrupt file: ${filePath}`, e);
                // Treat as very old/invalid
                ts = 0;
                isLegacy = true;
            }
        } else {
            // Trust filename timestamp
            ts = parseInt(match[1], 10);
        }
        
        branchFiles.push({ path: filePath, timestamp: ts, isLegacyName: isLegacy });
    }

    // Sort descending by timestamp
    branchFiles.sort((a, b) => b.timestamp - a.timestamp);

    const newestFile = branchFiles[0];
    const filesToDelete = branchFiles.slice(1);

    // 6. Cleanup Conflict Files
    // If we have multiple files, delete the older ones immediately to enforce single source of truth
    if (filesToDelete.length > 0) {
        console.log(`VC: Found ${vctrlFiles.length} branch files. Cleaning up ${filesToDelete.length} obsolete files.`);
        for (const file of filesToDelete) {
            try {
                await this.app.vault.adapter.remove(file.path);
            } catch (e) {
                console.warn(`VC: Failed to delete obsolete branch file: ${file.path}`, e);
            }
        }
    }

    if (!newestFile) return;

    // 7. Compare and Sync
    const maxFileTimestamp = newestFile.timestamp;

    // Tolerance for clock skew or processing time (e.g. 1000ms)
    const diff = maxFileTimestamp - dbTimestamp;

    if (diff > 1000) {
        // File is significantly newer -> Import
        try {
            const fileData = await withRetry(
                () => this.app.vault.adapter.readBinary(newestFile.path),
                MAX_RETRY_ATTEMPTS,
                RETRY_BASE_DELAY_MS
            );
            
            await proxy.importBranchData(
                noteId,
                branchName,
                transfer(fileData, [fileData])
            );
            console.log(`VC: Imported newer branch data from disk (${maxFileTimestamp} > ${dbTimestamp})`);
        } catch (e) {
            console.warn(`VC: Failed to import .vctrl file: ${newestFile.path}`, e);
        }
    } else if (diff < -1000) {
        // DB is significantly newer -> Export
        const shouldExport = await this.shouldPersist(noteId, branchName);
        if (shouldExport) {
            console.log(`VC: DB is newer (${dbTimestamp} > ${maxFileTimestamp}). Exporting DB.`);
            this.diskWriter.schedule(noteId, branchName);
        }
    } else {
        // Timestamps are close enough; assume synced.
    }
  }

  private async persistBranchToDiskInternal(write: ScheduledWrite): Promise<void> {
    const { noteId, branchName, sequence, retryCount } = write;
    
    if (!this.workerClient.isAvailable()) {
      throw new EditHistoryError('Worker unavailable during persistence', 'WORKER_UNAVAILABLE');
    }

    try {
      const proxy = this.workerClient.ensureWorker();
      
      // Get current manifest to determine timestamp
      const manifest = await proxy.getEditManifest(noteId);
      const timestamp = manifest ? new Date(manifest.lastModified).getTime() : Date.now();
      
      const zipBuffer = await proxy.exportBranchData(noteId, branchName);
      
      // zipBuffer will be valid even if empty (header only), so byteLength > 0.
      // We proceed to write it to ensure empty state is persisted.
      if (zipBuffer.byteLength === 0) {
          // This should theoretically not happen with correct zip generation, but if it does, abort.
          return;
      }

      const branchPath = this.pathService.getBranchPath(noteId, branchName);

      const folderExists = await this.app.vault.adapter.exists(branchPath);
      if (!folderExists) {
        await this.app.vault.adapter.mkdir(branchPath);
      }

      const unique = Math.random().toString(36).substring(2, 8);
      const filename = `${timestamp}_${unique}.vctrl`;
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

      // Cleanup ALL old files for this branch to ensure we only have the one we just wrote
      const result = await this.app.vault.adapter.list(branchPath);
      const oldFiles = result.files.filter(
        (f): f is string => f.endsWith('.vctrl') && f !== newFilePath
      );

      for (const oldFile of oldFiles) {
        try {
          await this.app.vault.adapter.remove(oldFile);
        } catch (e) {
          console.warn(`VC: Failed to cleanup old branch file: ${oldFile}`, e);
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

  /**
   * Checks if persistence is enabled for the given note and branch.
   */
  private async shouldPersist(noteId: string, branchName: string): Promise<boolean> {
      try {
          const proxy = this.workerClient.ensureWorker();
          const manifest = await proxy.getEditManifest(noteId);
          
          const globalDefaults = this.plugin.settings.editHistorySettings;
          
          if (!manifest) {
              return globalDefaults.enableDiskPersistence ?? true;
          }

          const branch = manifest.branches[branchName];
          const perBranchSettings = branch?.settings;
          
          // Default to Global if isGlobal is undefined or true.
          const isUnderGlobalInfluence = perBranchSettings?.isGlobal !== false;

          if (isUnderGlobalInfluence) {
              return globalDefaults.enableDiskPersistence ?? true;
          } else {
              // Local overrides Global
              return perBranchSettings?.enableDiskPersistence ?? globalDefaults.enableDiskPersistence ?? true;
          }
      } catch (e) {
          console.error("VC: Error resolving persistence setting", e);
          return true; // Default to safe behavior (persist)
      }
  }
}
