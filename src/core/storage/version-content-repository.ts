import { App, TFile } from "obsidian";
import { injectable, inject } from "inversify";
import { PathService } from "./path-service";
import type { NoteManifest } from "../../types";
import { TYPES } from "../../types/inversify.types";
import { QueueService } from "../../services/queue-service";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files,
 * and encapsulates concurrency control for write/delete operations.
 */
@injectable()
export class VersionContentRepository {
  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.PathService) private readonly pathService: PathService,
    @inject(TYPES.QueueService) private readonly queueService: QueueService
  ) {}

  public async read(
    noteId: string,
    versionId: string
  ): Promise<string | null> {
    if (!noteId || !versionId) return null;
    const versionFilePath = this.pathService.getNoteVersionPath(
      noteId,
      versionId
    );
    try {
      // Use the vault's adapter to read files directly from the filesystem.
      // This bypasses Obsidian's cache, which can be inconsistent for files in
      // hidden directories like `.versiondb`, resolving race conditions where a
      // file is read immediately after being written.
      if (!(await this.app.vault.adapter.exists(versionFilePath))) {
        // This is not a critical error, the file might have been deleted by a cleanup process.
        console.warn(
          `VC: Version file not found on read: ${versionFilePath}`
        );
        return null;
      }
      return await this.app.vault.adapter.read(versionFilePath);
    } catch (error) {
      console.error(
        `VC: Failed to read content for note ${noteId}, version ${versionId} using adapter.`,
        error
      );
      return null;
    }
  }

  public async write(
    noteId: string,
    versionId: string,
    content: string
  ): Promise<{ size: number }> {
    return this.queueService.enqueue(noteId, async () => {
        const versionFilePath = this.pathService.getNoteVersionPath(
          noteId,
          versionId
        );
        
        // Use the vault's adapter for direct, cache-free writing. This
        // ensures the file operation completes reliably without being affected
        // by cache latency.
        await this.app.vault.adapter.write(versionFilePath, content);

        // Calculate file size directly from the content. This is the most
        // reliable method, as TFile.stat.size can be stale after a write.
        // Using `new Blob([content]).size` correctly calculates the byte length
        // of the UTF-8 encoded string.
        const fileSize = new Blob([content]).size;
        
        return { size: fileSize };
    });
  }

  public async delete(
    noteId: string,
    versionId: string,
    options: { bypassQueue?: boolean } = {}
  ): Promise<void> {
    const task = async () => {
        const versionFilePath = this.pathService.getNoteVersionPath(
          noteId,
          versionId
        );
        
        // Use the adapter API for direct, permanent deletion of internal database files.
        // This bypasses user's trash settings, which is desired for the .versiondb directory.
        if (await this.app.vault.adapter.exists(versionFilePath)) {
            await this.app.vault.adapter.remove(versionFilePath);
        } else {
            // This is not an error, just a state check.
            console.warn(
                `VC: Version file to delete was already missing: ${versionFilePath}`
            );
        }
    };

    if (options.bypassQueue) {
        return task();
    }
    return this.queueService.enqueue(noteId, task);
  }

  public async getLatestVersionContent(
    noteId: string,
    noteManifest: NoteManifest
  ): Promise<string | null> {
    if (!noteManifest.versions) {
      return null;
    }

    const versions = Object.entries(noteManifest.versions).sort(
      ([, a], [, b]) => b.versionNumber - a.versionNumber
    );

    // Instead of checking the array's length and then accessing the element,
    // we access the element first and then check if the result is undefined.
    // This creates a direct and unambiguous type guard for the compiler.
    const latestVersionEntry = versions[0];

    // If the array was empty, latestVersionEntry will be undefined. This check
    // now correctly informs TypeScript that it is safe to use in the next line.
    if (!latestVersionEntry) {
      return null;
    }

    // This is now guaranteed to be safe because of the explicit check above.
    const [latestVersionId] = latestVersionEntry;
    
    return this.read(noteId, latestVersionId);
  }
}
