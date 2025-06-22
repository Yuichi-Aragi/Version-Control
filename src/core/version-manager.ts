import { App, TFile, Notice } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NoteManager } from "./note-manager";
import { VersionHistoryEntry } from "../types";
import { removeFrontmatterKey, generateUniqueFilePath } from "../utils/file";

// Forward declaration for the CleanupManager to avoid circular dependency issues
interface ICleanupManager {
    scheduleCleanup(noteId: string): void;
}

export class VersionManager {
    private app: App;
    private manifestManager: ManifestManager;
    private noteManager: NoteManager;
    private cleanupManager: ICleanupManager;

    constructor(app: App, manifestManager: ManifestManager, noteManager: NoteManager, cleanupManager: ICleanupManager) {
        this.app = app;
        this.manifestManager = manifestManager;
        this.noteManager = noteManager;
        this.cleanupManager = cleanupManager;
    }

    /**
     * Saves a new version of the specified file.
     */
    async saveNewVersion(file: TFile, name?: string): Promise<boolean> {
        if (!file) {
            console.error("Version Control: Invalid file provided for version saving.");
            return false;
        }

        try {
            const noteId = await this.noteManager.getNoteId(file, true);
            if (!noteId) {
                new Notice("Failed to get or create a version control ID for this note.");
                return false;
            }

            let noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest) {
                noteManifest = await this.manifestManager.createNoteEntry(noteId, file.path);
            } else if (noteManifest.notePath !== file.path) {
                await this.manifestManager.updateNotePath(noteId, file.path);
            }

            const content = await this.app.vault.read(file);
            const versionNumber = noteManifest.totalVersions + 1;
            const versionId = `V${versionNumber}`;
            const timestamp = new Date().toISOString();
            const versionPath = this.manifestManager.getNoteVersionPath(noteId, versionId);

            await this.app.vault.adapter.write(versionPath, content);
            
            let fileSize = content.length;
            try {
                const stats = await this.app.vault.adapter.stat(versionPath);
                if (!stats) {
                    throw new Error("Failed to get stats for new version file.");
                }
                fileSize = stats.size;
            } catch (statError) {
                console.warn(`Version Control: Could not get file stats for ${versionPath}. This is non-critical and file size will be based on content length.`, statError);
            }

            noteManifest.versions[versionId] = {
                versionNumber,
                timestamp,
                name: name?.trim() || undefined,
                filePath: versionPath,
                size: fileSize,
            };
            noteManifest.totalVersions = versionNumber;
            noteManifest.lastModified = timestamp;

            await this.manifestManager.saveNoteManifest(noteManifest);
            
            const displayName = name ? `"${name}"` : `V${versionNumber}`;
            new Notice(`Version ${displayName} saved for ${file.basename}.`);

            this.cleanupManager.scheduleCleanup(noteId);
            
            return true;

        } catch (error) {
            console.error("Version Control: Failed to save new version.", error);
            new Notice("Error: Could not save new version. Check console for details.");
            return false;
        }
    }

    /**
     * Retrieves version history for a note.
     */
    async getVersionHistory(noteId: string): Promise<VersionHistoryEntry[]> {
        if (!noteId) return [];

        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest) return [];

            return Object.entries(noteManifest.versions)
                .map(([id, data]) => ({
                    id,
                    noteId,
                    versionNumber: data.versionNumber,
                    timestamp: data.timestamp,
                    name: data.name,
                    size: data.size,
                }))
                .sort((a, b) => b.versionNumber - a.versionNumber);
        } catch (error) {
            console.error("Version Control: Failed to get version history", error);
            new Notice("Error getting version history. Check console.");
            return [];
        }
    }

    /**
     * Retrieves content for a specific version.
     */
    async getVersionContent(noteId: string, versionId: string): Promise<string | null> {
        if (!noteId || !versionId) return null;

        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions[versionId]) {
                console.error(`Version Control: Version ${versionId} not found in manifest for note ${noteId}.`);
                new Notice(`Version ${versionId} not found in manifest.`);
                return null;
            }

            const versionPath = noteManifest.versions[versionId].filePath;
            if (!await this.app.vault.adapter.exists(versionPath)) {
                console.error(`Version Control: Data integrity issue. Version file not found at path: ${versionPath}`);
                new Notice(`Error: Version ${versionId} file is missing.`);
                return null;
            }

            return await this.app.vault.adapter.read(versionPath);
        } catch (error) {
            console.error(`Version Control: Failed to read version content for ${versionId}`, error);
            return null;
        }
    }

    /**
     * Restores a file to a previous version by overwriting its content.
     * This is a low-level operation; it's assumed that any necessary backups
     * have already been created by the calling function (e.g., a thunk).
     */
    async restoreVersion(file: TFile, noteId: string, versionId: string): Promise<boolean> {
        if (!file || !noteId || !versionId) {
            new Notice("Error: Invalid parameters for version restoration.");
            return false;
        }

        try {
            // Ensure the target file still exists before proceeding.
            const targetFile = this.app.vault.getAbstractFileByPath(file.path);
            if (!(targetFile instanceof TFile)) {
                new Notice(`Restoration failed: Note "${file.basename}" no longer exists.`);
                return false;
            }

            const content = await this.getVersionContent(noteId, versionId);
            if (content === null) {
                new Notice("Error: Could not load version content to restore.");
                return false;
            }

            // The core operation: modify the file content.
            await this.app.vault.modify(targetFile, content);
            new Notice(`Successfully restored to version ${versionId}.`);
            return true;

        } catch (error) {
            console.error("Version Control: Failed to restore version", error);
            new Notice("Error: Could not restore version. Check console for details.");
            return false;
        }
    }

    /**
     * Creates a deviation (new file) from a specific version.
     */
    async createDeviation(noteId: string, versionId: string): Promise<boolean> {
        if (!noteId || !versionId) {
            new Notice("Error: Invalid parameters for creating deviation.");
            return false;
        }

        try {
            let content = await this.getVersionContent(noteId, versionId);
            if (content === null) {
                new Notice("Error: Could not load version content for deviation.");
                return false;
            }

            content = removeFrontmatterKey(content, "vc-id");

            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const abstractFile = noteManifest 
                ? this.app.vault.getAbstractFileByPath(noteManifest.notePath)
                : null;
            const originalFile = abstractFile instanceof TFile ? abstractFile : null;

            const baseName = originalFile?.basename || 'Untitled';
            const parentFolder = originalFile?.parent;
            
            const baseFileName = `${baseName} (deviation from ${versionId})`;
            const newFilePath = await generateUniqueFilePath(this.app, baseFileName, parentFolder?.path);

            const newFile = await this.app.vault.create(newFilePath, content);
            await this.app.workspace.getLeaf(true).openFile(newFile);
            new Notice(`Created new note "${newFile.basename}" from version ${versionId}.`);
            return true;

        } catch (error) {
            console.error("Version Control: Failed to create deviation.", error);
            new Notice("Error: Could not create new note from version.");
            return false;
        }
    }

    /**
     * Deletes a specific version.
     */
    async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
        if (!noteId || !versionId) return false;

        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions[versionId]) {
                new Notice("Error: Version not found in manifest.");
                return false;
            }

            const versionPath = noteManifest.versions[versionId].filePath;
            delete noteManifest.versions[versionId];
            noteManifest.lastModified = new Date().toISOString();

            await this.manifestManager.saveNoteManifest(noteManifest);
            
            if (await this.app.vault.adapter.exists(versionPath)) {
                await this.app.vault.adapter.remove(versionPath);
            } else {
                console.warn(`Version Control: Version file to delete was already missing: ${versionPath}`);
            }

            new Notice(`Deleted version ${versionId}.`);
            return true;

        } catch (error) {
            console.error("Version Control: Failed to delete version.", error);
            new Notice("Error: Could not delete version.");
            return false;
        }
    }

    /**
     * Deletes all versions for a note.
     */
    async deleteAllVersions(noteId: string): Promise<boolean> {
        if (!noteId) return false;

        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest) {
                new Notice("No versions found for this note.");
                return false;
            }

            const file = this.app.vault.getAbstractFileByPath(noteManifest.notePath);
            
            const deletionPromises = Object.values(noteManifest.versions).map(async (version: any) => {
                try {
                    if (await this.app.vault.adapter.exists(version.filePath)) {
                        await this.app.vault.adapter.remove(version.filePath);
                    }
                } catch (error) {
                    console.error(`Failed to delete version file ${version.filePath}:`, error);
                }
            });

            await Promise.allSettled(deletionPromises);
            
            await this.manifestManager.deleteNoteEntry(noteId);
            
            if (file instanceof TFile) {
                try {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        delete frontmatter["vc-id"];
                    });
                } catch (error) {
                    console.warn(`Version Control: Could not clean frontmatter for ${file.path} after deleting all versions. You may need to remove the 'vc-id' key manually.`, error);
                    new Notice("Could not remove vc-id from frontmatter. Please remove it manually.");
                }
            } else {
                console.log(`Version Control: Note at path ${noteManifest.notePath} was not found. Skipping frontmatter cleanup.`);
            }

            new Notice(`All versions for the note have been deleted.`);
            return true;

        } catch (error) {
            console.error("Version Control: Failed to delete all versions.", error);
            new Notice("Error: Could not delete all versions.");
            return false;
        }
    }
}