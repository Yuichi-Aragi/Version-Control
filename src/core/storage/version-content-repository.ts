import { App, TFile } from "obsidian";
import { PathService } from "./path-service";
import { NoteManifest } from "../../types";

/**
 * Repository for managing the content of individual versions.
 * Handles reading, writing, and deleting the actual version files.
 */
export class VersionContentRepository {
    constructor(private app: App, private pathService: PathService) {}

    public async read(noteId: string, versionId: string): Promise<string | null> {
        if (!noteId || !versionId) return null;
        try {
            const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
            if (!await this.app.vault.adapter.exists(versionFilePath)) {
                console.error(`VC: Data integrity issue. Version file missing: ${versionFilePath}`);
                return null;
            }
            return await this.app.vault.adapter.read(versionFilePath);
        } catch (error) {
            console.error(`VC: Failed to read content for note ${noteId}, version ${versionId}.`, error);
            return null;
        }
    }

    public async write(noteId: string, versionId: string, content: string): Promise<{ size: number }> {
        const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
        await this.app.vault.adapter.write(versionFilePath, content);
        
        let fileSize = content.length;
        try {
            const stats = await this.app.vault.adapter.stat(versionFilePath);
            fileSize = stats?.size ?? fileSize;
        } catch (statError) {
            console.warn(`VC: Could not get file stats for ${versionFilePath}. Using content length.`, statError);
        }
        return { size: fileSize };
    }

    public async delete(noteId: string, versionId: string): Promise<void> {
        const versionFilePath = this.pathService.getNoteVersionPath(noteId, versionId);
        if (await this.app.vault.adapter.exists(versionFilePath)) {
            await this.app.vault.adapter.remove(versionFilePath);
        } else {
            console.warn(`VC: Version file to delete was already missing: ${versionFilePath}`);
        }
    }

    public async getLatestVersionContent(noteId: string, noteManifest: NoteManifest): Promise<string | null> {
        if (noteManifest.totalVersions === 0) {
            return null;
        }
        const versions = Object.entries(noteManifest.versions)
            .sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
        
        if (versions.length > 0) {
            const latestVersionId = versions[0][0];
            return this.read(noteId, latestVersionId);
        }
        return null;
    }
}
