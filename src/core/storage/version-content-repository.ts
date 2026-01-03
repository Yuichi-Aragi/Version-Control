import { App } from "obsidian";
import { PathService } from "@/core";
import type { NoteManifest } from "@/types";
import { QueueService } from "@/services";
import { CompressionManager } from "@/core";
import type VersionControlPlugin from "@/main";
import { TaskPriority } from "@/types";
import { executeWithRetry } from "@/utils/retry";
import { StorageService } from "@/core/storage/storage-service";

/**
 * Repository for managing the content of individual versions.
 * Uses shared retry logic with timeout configuration and robust storage service.
 */
export class VersionContentRepository {
  private readonly FILE_OPERATION_TIMEOUT_MS = 5000;
  private readonly QUEUE_PREFIX = 'content:';
  private readonly GZIP_MAGIC_0 = 0x1f;
  private readonly GZIP_MAGIC_1 = 0x8b;

  constructor(
    private readonly app: App,
    private readonly plugin: VersionControlPlugin,
    private readonly pathService: PathService,
    private readonly queueService: QueueService,
    private readonly compressionManager: CompressionManager,
    private readonly storageService: StorageService
  ) {
    if (!this.app?.vault?.adapter) throw new Error('VersionContentRepository: Invalid dependencies');
  }

  private getQueueKey(noteId: string): string {
    return `${this.QUEUE_PREFIX}${noteId}`;
  }

  public async read(noteId: string, versionId: string): Promise<string | null> {
    return this.queueService.add(
        this.getQueueKey(noteId), 
        () => this._readInternal(noteId, versionId),
        { priority: TaskPriority.NORMAL }
    );
  }

  public async readBinary(noteId: string, versionId: string): Promise<ArrayBuffer | null> {
    return this.queueService.add(
        this.getQueueKey(noteId), 
        () => this._readBinaryInternal(noteId, versionId),
        { priority: TaskPriority.NORMAL }
    );
  }

  public async write(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
    return this.queueService.add(
        this.getQueueKey(noteId), 
        () => this._writeInternal(noteId, versionId, content),
        { priority: TaskPriority.HIGH }
    );
  }

  public async delete(noteId: string, versionId: string): Promise<void> {
    return this.queueService.add(
        this.getQueueKey(noteId), 
        () => this._deleteInternal(noteId, versionId),
        { priority: TaskPriority.HIGH }
    );
  }

  public async rename(noteId: string, oldVersionId: string, newVersionId: string): Promise<void> {
    return this.queueService.add(
        this.getQueueKey(noteId), 
        () => this._renameInternal(noteId, oldVersionId, newVersionId),
        { priority: TaskPriority.HIGH }
    );
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

  private isGzip(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 2) return false;
    const view = new Uint8Array(buffer);
    return view[0] === this.GZIP_MAGIC_0 && view[1] === this.GZIP_MAGIC_1;
  }

  private async _readInternal(noteId: string, versionId: string): Promise<string | null> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    
    return executeWithRetry(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (!exists) return null;

        const buffer = await this.app.vault.adapter.readBinary(versionFilePath);
        const isCompressed = this.isGzip(buffer);
        const enableCompression = this.plugin.settings.enableCompression;

        if (isCompressed) {
            const decompressed = await this.compressionManager.decompress(buffer);
            if (!enableCompression) {
                await this.app.vault.adapter.write(versionFilePath, decompressed);
            }
            return decompressed;
        } else {
            const decoder = new TextDecoder('utf-8');
            const content = decoder.decode(buffer);
            if (enableCompression) {
                const compressed = await this.compressionManager.compress(content);
                await this.app.vault.adapter.writeBinary(versionFilePath, compressed);
            }
            return content;
        }
      },
      { 
          context: `read_${noteId}_${versionId}`,
          timeout: this.FILE_OPERATION_TIMEOUT_MS
      }
    ).catch((error) => {
        console.error(`VC: Failed to read version ${versionId}`, error);
        return null;
    });
  }

  private async _readBinaryInternal(noteId: string, versionId: string): Promise<ArrayBuffer | null> {
    const content = await this._readInternal(noteId, versionId);
    if (content === null) return null;
    return new TextEncoder().encode(content).buffer;
  }

  private async _writeInternal(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
    const enableCompression = this.plugin.settings.enableCompression;

    // Robustness: Ensure parent folder exists before writing
    const versionsPath = this.pathService.getNoteVersionsPath(noteId);
    await this.storageService.ensureFolderExists(versionsPath);

    await executeWithRetry(
      async () => {
        if (enableCompression) {
            const compressed = await this.compressionManager.compress(content);
            await this.app.vault.adapter.writeBinary(versionFilePath, compressed);
        } else {
            await this.app.vault.adapter.write(versionFilePath, content);
        }
      },
      { 
          context: `write_${noteId}_${versionId}`,
          timeout: this.FILE_OPERATION_TIMEOUT_MS
      }
    );

    return { size: new Blob([content]).size };
  }

  private async _deleteInternal(noteId: string, versionId: string): Promise<void> {
    const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);

    await executeWithRetry(
      async () => {
        const exists = await this.app.vault.adapter.exists(versionFilePath);
        if (exists) {
          await this.app.vault.adapter.remove(versionFilePath);
        }
      },
      { 
          context: `delete_${noteId}_${versionId}`,
          timeout: this.FILE_OPERATION_TIMEOUT_MS
      }
    );
  }

  private async _renameInternal(noteId: string, oldVersionId: string, newVersionId: string): Promise<void> {
    const oldPath = this.pathService.getNoteVersionPath(noteId, oldVersionId);
    const newPath = this.pathService.getNoteVersionPath(noteId, newVersionId);

    // Robustness: Ensure target parent folder exists (though it should for rename in same dir)
    const versionsPath = this.pathService.getNoteVersionsPath(noteId);
    await this.storageService.ensureFolderExists(versionsPath);

    await executeWithRetry(
      async () => {
        const sourceExists = await this.app.vault.adapter.exists(oldPath);
        const targetExists = await this.app.vault.adapter.exists(newPath);

        if (!sourceExists) {
          if (targetExists) return;
          throw new Error(`Source file missing: ${oldPath}`);
        }
        if (targetExists) throw new Error(`Target file exists: ${newPath}`);

        try {
            await this.app.vault.adapter.rename(oldPath, newPath);
        } catch (error) {
            const s = await this.app.vault.adapter.exists(oldPath);
            const t = await this.app.vault.adapter.exists(newPath);
            if (!s && t) return;
            throw error;
        }
      },
      { 
          context: `rename_${noteId}_${oldVersionId}_to_${newVersionId}`,
          timeout: this.FILE_OPERATION_TIMEOUT_MS
      }
    );
  }
}
