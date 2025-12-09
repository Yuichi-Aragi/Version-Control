import { App } from "obsidian";
import { injectable, inject } from "inversify";
import { PathService } from "./path-service";
import type { NoteManifest } from "../../types";
import { TYPES } from "../../types/inversify.types";
import { QueueService } from "../../services/queue-service";
import { CompressionManager } from "../compression-manager";
import type VersionControlPlugin from "../../main";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files.
 * 
 * FEATURES:
 * - Transparent GZIP compression/decompression via CompressionManager.
 * - Lazy migration: Automatically compresses uncompressed files on read if enabled.
 * - Backward compatibility: Handles both compressed and uncompressed files.
 * - Concurrency control via QueueService.
 */
@injectable()
export class VersionContentRepository {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private readonly FILE_OPERATION_TIMEOUT_MS = 5000;
  private readonly QUEUE_PREFIX = 'content:';

  // GZIP Magic Numbers
  private readonly GZIP_MAGIC_0 = 0x1f;
  private readonly GZIP_MAGIC_1 = 0x8b;

  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService,
    @inject(TYPES.CompressionManager) private readonly compressionManager: CompressionManager
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
    if (!noteManifest || !noteManifest.branches) return null;
    const currentBranch = noteManifest.branches[noteManifest.currentBranch];
    if (!currentBranch || !currentBranch.versions) return null;

    const versions = Object.entries(currentBranch.versions).sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
    if (versions.length === 0) return null;

    const latestEntry = versions[0];
    if (!latestEntry) return null;

    const latestVersionId = latestEntry[0];
    if (!latestVersionId) return null;

    return this.read(noteId, latestVersionId);
  }

  // ==================================================================================
  // INTERNAL IMPLEMENTATION (Unqueued, Retry Logic)
  // ==================================================================================

  private isGzip(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 2) return false;
    const view = new Uint8Array(buffer);
    return view[0] === this.GZIP_MAGIC_0 && view[1] === this.GZIP_MAGIC_1;
  }

  private async _read(noteId: string, versionId: string): Promise<string | null> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    
    return this.executeWithRetryAndTimeout(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (!exists) return null;

        // Always read as binary first to check for compression
        const buffer = await this.app.vault.adapter.readBinary(versionFilePath);
        const isCompressed = this.isGzip(buffer);
        const enableCompression = this.plugin.settings.enableCompression;

        if (isCompressed) {
            const decompressed = await this.compressionManager.decompress(buffer);
            
            // Migration: If compression is disabled but file is compressed, save decompressed version
            if (!enableCompression) {
                await this.app.vault.adapter.write(versionFilePath, decompressed);
            }
            return decompressed;
        } else {
            // File is uncompressed (legacy or text)
            const decoder = new TextDecoder('utf-8');
            const content = decoder.decode(buffer);

            // Migration: If compression is enabled but file is uncompressed, compress and save
            if (enableCompression) {
                const compressed = await this.compressionManager.compress(content);
                await this.app.vault.adapter.writeBinary(versionFilePath, compressed);
            }
            return content;
        }
      },
      `read_${noteId}_${versionId}`
    ).catch((error) => {
        console.error(`VC: Failed to read version ${versionId}`, error);
        return null;
    });
  }

  private async _readBinary(noteId: string, versionId: string): Promise<ArrayBuffer | null> {
    // DiffManager expects the *logical* binary content (utf-8 bytes of the text), 
    // not the physical compressed bytes.
    const content = await this._read(noteId, versionId);
    if (content === null) return null;
    return new TextEncoder().encode(content).buffer;
  }

  private async _write(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    const enableCompression = this.plugin.settings.enableCompression;

    await this.executeWithRetryAndTimeout(
      async () => {
        if (enableCompression) {
            const compressed = await this.compressionManager.compress(content);
            await this.app.vault.adapter.writeBinary(versionFilePath, compressed);
        } else {
            await this.app.vault.adapter.write(versionFilePath, content);
        }
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
