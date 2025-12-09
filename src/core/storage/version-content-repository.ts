import { App } from "obsidian";
import { injectable, inject } from "inversify";
import { PathService } from "./path-service";
import type { NoteManifest } from "../../types";
import { TYPES } from "../../types/inversify.types";
import { QueueService } from "../../services/queue-service";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files,
 * and encapsulates concurrency control for write/delete operations.
 * 
 * ARCHITECTURE NOTE:
 * All public methods are queued using QueueService to prevent race conditions.
 * Internal methods (_methodName) contain the actual logic and retry mechanisms
 * but DO NOT interact with the queue to prevent deadlocks.
 * 
 * DEADLOCK PROTECTION:
 * Uses a 'content:' prefix for all queue keys to ensure isolation from 
 * other services (like NoteManifestRepository) operating on the same noteId.
 */
@injectable()
export class VersionContentRepository {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private readonly FILE_OPERATION_TIMEOUT_MS = 5000;
  private readonly QUEUE_PREFIX = 'content:';

  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService
  ) {
    if (!this.app?.vault?.adapter) throw new Error('VersionContentRepository: Invalid dependencies');
  }

  private getQueueKey(noteId: string): string {
    return `${this.QUEUE_PREFIX}${noteId}`;
  }

  // ==================================================================================
  // PUBLIC API (Queued)
  // ==================================================================================

  public async read(noteId: string, versionId: string): Promise<string | null> {
    return this.queueService.enqueue(this.getQueueKey(noteId), () => this._read(noteId, versionId));
  }

  public async readBinary(noteId: string, versionId: string): Promise<ArrayBuffer | null> {
    return this.queueService.enqueue(this.getQueueKey(noteId), () => this._readBinary(noteId, versionId));
  }

  public async write(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
    return this.queueService.enqueue(this.getQueueKey(noteId), () => this._write(noteId, versionId, content));
  }

  public async delete(noteId: string, versionId: string): Promise<void> {
    return this.queueService.enqueue(this.getQueueKey(noteId), () => this._delete(noteId, versionId));
  }

  public async rename(noteId: string, oldVersionId: string, newVersionId: string): Promise<void> {
    return this.queueService.enqueue(this.getQueueKey(noteId), () => this._rename(noteId, oldVersionId, newVersionId));
  }

  public async getLatestVersionContent(noteId: string, noteManifest: NoteManifest): Promise<string | null> {
    // This method is a composition of logic and a read call. 
    // Since it calls `read` (which queues), we don't queue the wrapper itself 
    // to avoid holding the lock during the manifest parsing (though that's fast).
    
    if (!noteManifest || !noteManifest.branches) return null;
    const currentBranch = noteManifest.branches[noteManifest.currentBranch];
    if (!currentBranch || !currentBranch.versions) return null;

    const versions = Object.entries(currentBranch.versions).sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
    if (versions.length === 0) return null;

    // Fix for TS2488 and noUncheckedIndexedAccess: Explicitly check for undefined before accessing
    const latestEntry = versions[0];
    if (!latestEntry) return null;

    const latestVersionId = latestEntry[0];
    if (!latestVersionId) return null;

    return this.read(noteId, latestVersionId);
  }

  // ==================================================================================
  // INTERNAL IMPLEMENTATION (Unqueued, Retry Logic)
  // ==================================================================================

  private async _read(noteId: string, versionId: string): Promise<string | null> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    
    return this.executeWithRetryAndTimeout(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (!exists) return null;
        return await this.app.vault.adapter.read(versionFilePath);
      },
      `read_${noteId}_${versionId}`
    ).catch(() => null);
  }

  private async _readBinary(noteId: string, versionId: string): Promise<ArrayBuffer | null> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);

    return this.executeWithRetryAndTimeout(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (!exists) return null;
        return await this.app.vault.adapter.readBinary(versionFilePath);
      },
      `readBinary_${noteId}_${versionId}`
    ).catch(() => null);
  }

  private async _write(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);

    await this.executeWithRetryAndTimeout(
      async () => {
        await this.app.vault.adapter.write(versionFilePath, content);
      },
      `write_${noteId}_${versionId}`
    );

    return { size: new Blob([content]).size };
  }

  private async _delete(noteId: string, versionId: string): Promise<void> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);

    await this.executeWithRetryAndTimeout(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (exists) {
          await this.app.vault.adapter.remove(versionFilePath);
        }
      },
      `delete_${noteId}_${versionId}`
    );
  }

  private async _rename(noteId: string, oldVersionId: string, newVersionId: string): Promise<void> {
    const oldPath = this.pathService.getNoteVersionPath(noteId, oldVersionId);
    const newPath = this.pathService.getNoteVersionPath(noteId, newVersionId);

    await this.executeWithRetryAndTimeout(
      async () => {
        const sourceExists = await this.app.vault.adapter.exists(oldPath);
        const targetExists = await this.app.vault.adapter.exists(newPath);

        if (!sourceExists) {
          if (targetExists) return; // Idempotency: already renamed
          throw new Error(`Source file missing: ${oldPath}`);
        }
        if (targetExists) throw new Error(`Target file exists: ${newPath}`);

        try {
            await this.app.vault.adapter.rename(oldPath, newPath);
        } catch (error) {
            // False positive check
            const s = await this.app.vault.adapter.exists(oldPath);
            const t = await this.app.vault.adapter.exists(newPath);
            if (!s && t) return;
            throw error;
        }
      },
      `rename_${noteId}_${oldVersionId}_to_${newVersionId}`
    );
  }

  // ==================================================================================
  // HELPERS
  // ==================================================================================

  private async executeWithRetryAndTimeout<T>(
    operation: () => Promise<T>,
    operationId: string,
    maxRetries = this.MAX_RETRIES,
    retryDelay = this.RETRY_DELAY_MS
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout: ${operationId}`)), this.FILE_OPERATION_TIMEOUT_MS)
          )
        ]);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
