import { App } from "obsidian";
import { injectable, inject } from "inversify";
import { PathService } from "./path-service";
import type { NoteManifest } from "../../types";
import { TYPES } from "../../types/inversify.types";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files.
 */
@injectable()
export class VersionContentRepository {
  constructor(
    @inject(TYPES.App) private readonly app: App,
    @inject(TYPES.PathService) private readonly pathService: PathService
  ) {}

  public async read(
    noteId: string,
    versionId: string
  ): Promise<string | null> {
    if (!noteId || !versionId) return null;
    try {
      const versionFilePath = this.pathService.getNoteVersionPath(
        noteId,
        versionId
      );
      if (!(await this.app.vault.adapter.exists(versionFilePath))) {
        console.error(
          `VC: Data integrity issue. Version file missing: ${versionFilePath}`
        );
        return null;
      }
      return await this.app.vault.adapter.read(versionFilePath);
    } catch (error) {
      console.error(
        `VC: Failed to read content for note ${noteId}, version ${versionId}.`,
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
    const versionFilePath = this.pathService.getNoteVersionPath(
      noteId,
      versionId
    );
    await this.app.vault.adapter.write(versionFilePath, content);

    let fileSize = content.length;
    try {
      const stats = await this.app.vault.adapter.stat(versionFilePath);
      // Ensure stats is defined and has a numeric size property
      if (stats?.size !== undefined) {
        fileSize = stats.size;
      }
    } catch (statError) {
      console.warn(
        `VC: Could not get file stats for ${versionFilePath}. Using content length.`,
        statError
      );
    }
    return { size: fileSize };
  }

  public async delete(
    noteId: string,
    versionId: string
  ): Promise<void> {
    const versionFilePath = this.pathService.getNoteVersionPath(
      noteId,
      versionId
    );
    if (await this.app.vault.adapter.exists(versionFilePath)) {
      await this.app.vault.adapter.remove(versionFilePath);
    } else {
      console.warn(
        `VC: Version file to delete was already missing: ${versionFilePath}`
      );
    }
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

    // Fix: Instead of checking the array's length and then accessing the element,
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
