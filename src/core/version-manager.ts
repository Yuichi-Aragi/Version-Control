import { App, TFile, MarkdownView, FrontMatterCache, TFolder } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NoteManager } from "./note-manager";
import { VersionHistoryEntry, NoteManifest } from "../types";
import { generateUniqueFilePath } from "../utils/file";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";
import { generateUniqueId } from "../utils/id";
import { VersionContentRepository } from "./storage/version-content-repository";
import { parseNameAndTags } from "../utils/version-parser";

/**
 * Manages the core business logic for versioning operations like saving,
 * restoring, deleting, and retrieving versions. It orchestrates other services
 * and repositories to perform its tasks.
 */
export class VersionManager {
    constructor(
        private app: App, 
        private manifestManager: ManifestManager, 
        private noteManager: NoteManager, 
        private versionContentRepo: VersionContentRepository,
        private eventBus: PluginEvents
    ) {}

    /**
     * Saves a new version of a given file. This method encapsulates the entire
     * process, including getting or creating a note ID, in a more atomic way.
     * @param file The TFile to save a version of.
     * @param nameAndTags An optional string containing the name and tags for the new version.
     * @param options.force If true, saves the version even if content is identical to the last one.
     * @returns An object indicating if the version was saved or was a duplicate.
     */
    async saveNewVersionForFile(
        file: TFile, 
        nameAndTags?: string, 
        options: { force?: boolean } = {}
    ): Promise<{ status: 'saved' | 'duplicate', newVersionEntry: VersionHistoryEntry | null, displayName: string, newNoteId: string }> {
        const { force = false } = options;

        if (!file) {
            throw new Error("Invalid file provided to saveNewVersionForFile.");
        }

        const noteId = await this.noteManager.getOrCreateNoteId(file);
        if (!noteId) {
            throw new Error("Could not get or create a note ID for the file.");
        }

        let noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) {
            console.warn(`VC: Manifest for note ${noteId} missing during save. Recreating.`);
            noteManifest = await this.manifestManager.createNoteEntry(noteId, file.path);
        }

        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const contentToSave = (activeMarkdownView?.file?.path === file.path)
            ? activeMarkdownView.editor.getValue()
            : await this.app.vault.cachedRead(file);

        // Check for duplicate content, unless forced
        if (!force) {
            const latestContent = await this.versionContentRepo.getLatestVersionContent(noteId, noteManifest);
            if (latestContent !== null && latestContent === contentToSave) {
                console.log(`VC: Content for "${file.path}" is identical to the latest version. Skipping save.`);
                return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
            }
        }

        const versionId = generateUniqueId();
        try {
            const { size } = await this.versionContentRepo.write(noteId, versionId, contentToSave);
            const { name, tags } = parseNameAndTags(nameAndTags || '');
            const timestamp = new Date().toISOString();

            const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                const versionNumber = (manifest.totalVersions || 0) + 1;
                manifest.versions[versionId] = {
                    versionNumber, timestamp, size,
                    name: name || undefined,
                    tags: tags.length > 0 ? tags : undefined,
                };
                manifest.totalVersions = versionNumber;
                manifest.lastModified = timestamp;
                return manifest;
            });

            const savedVersionData = updatedManifest.versions[versionId];
            const displayName = name ? `"${name}" (V${savedVersionData.versionNumber})` : `Version ${savedVersionData.versionNumber}`;
            this.eventBus.trigger('version-saved', noteId);

            return {
                status: 'saved',
                newVersionEntry: {
                    id: versionId, noteId, notePath: file.path,
                    versionNumber: savedVersionData.versionNumber,
                    timestamp: timestamp, name: name || undefined,
                    tags: tags.length > 0 ? tags : undefined, size,
                },
                displayName, newNoteId: noteId,
            };

        } catch (error) {
            console.error(`VC: CRITICAL FAILURE in saveNewVersionForFile for "${file.path}". Rolling back.`, error);
            await this.versionContentRepo.delete(noteId, versionId).catch(cleanupError => {
                console.error(`VC: FAILED to clean up orphaned version file after an error: ${versionId}`, cleanupError);
            });
            this.manifestManager.invalidateNoteManifestCache(noteId);
            throw error;
        }
    }

    async updateVersionDetails(noteId: string, versionId: string, nameAndTags: string): Promise<void> {
        if (!noteId || !versionId) {
            throw new Error("Invalid noteId or versionId for updateVersionDetails.");
        }
        
        const { name, tags } = parseNameAndTags(nameAndTags);

        await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
            if (!manifest.versions[versionId]) {
                throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);
            }
            manifest.versions[versionId].name = name || undefined;
            manifest.versions[versionId].tags = tags.length > 0 ? tags : undefined;
            manifest.lastModified = new Date().toISOString();
            return manifest;
        });

        console.log(`VC: Updated details for version ${versionId} to name: "${name}", tags: [${tags.join(', ')}].`);
    }

    async getVersionHistory(noteId: string): Promise<VersionHistoryEntry[]> {
        if (!noteId) return [];
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions) return [];

            return Object.entries(noteManifest.versions)
                .map(([id, data]) => ({
                    id, noteId, notePath: noteManifest.notePath, versionNumber: data.versionNumber,
                    timestamp: data.timestamp, name: data.name, tags: data.tags, size: data.size,
                }))
                .sort((a, b) => b.versionNumber - a.versionNumber);
        } catch (error) {
            console.error(`VC: Failed to get version history for note ${noteId}.`, error);
            throw new Error(`Failed to get version history for note ${noteId}.`);
        }
    }

    async getVersionContent(noteId: string, versionId: string): Promise<string | null> {
        return this.versionContentRepo.read(noteId, versionId);
    }

    async restoreVersion(liveFile: TFile, noteId: string, versionId: string): Promise<boolean> {
        if (!liveFile || !noteId || !versionId) {
            throw new Error("Invalid parameters for version restoration.");
        }
        try {
            if (!await this.app.vault.adapter.exists(liveFile.path)) {
                throw new Error(`Restoration failed. Note "${liveFile.basename}" no longer exists.`);
            }
            const versionContent = await this.getVersionContent(noteId, versionId);
            if (versionContent === null) {
                throw new Error("Could not load version content to restore.");
            }
            await this.app.vault.modify(liveFile, versionContent);
            return true;
        } catch (error) {
            console.error(`VC: Failed to restore note ${noteId} to version ${versionId}.`, error);
            throw error;
        }
    }

    async createDeviation(noteId: string, versionId: string, targetFolder?: TFolder | null): Promise<TFile | null> {
        if (!noteId || !versionId) {
            throw new Error("Invalid parameters for creating deviation.");
        }
        try {
            let versionContent = await this.getVersionContent(noteId, versionId);
            if (versionContent === null) {
                throw new Error("Could not load version content for deviation.");
            }
            
            // Create a temporary file to safely process frontmatter using Obsidian's robust API
            const tempFileName = `.vc-temp-deviation-${Date.now()}.md`;
            const tempFile = await this.app.vault.create(tempFileName, versionContent);
            try {
                await this.app.fileManager.processFrontMatter(tempFile, (fm) => {
                    delete fm[NOTE_FRONTMATTER_KEY];
                });
                versionContent = await this.app.vault.read(tempFile);
            } finally {
                // Ensure the temporary file is always deleted
                await this.app.vault.delete(tempFile).catch(err => {
                    console.error("VC: Failed to delete temporary deviation file.", err);
                });
            }

            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const originalFile = noteManifest ? this.app.vault.getAbstractFileByPath(noteManifest.notePath) : null;
            const originalTFile = originalFile instanceof TFile ? originalFile : null;

            const baseName = originalTFile?.basename || 'Untitled Version';
            let parentPath = targetFolder?.isRoot() ? '' : (targetFolder?.path ?? originalTFile?.parent?.path ?? '');
            if (parentPath === '/') parentPath = '';
            
            const newFileNameBase = `${baseName} (from V${versionId.substring(0,6)}...)`;
            const newFilePath = await generateUniqueFilePath(this.app, newFileNameBase, parentPath);

            return await this.app.vault.create(newFilePath, versionContent);
        } catch (error) {
            console.error(`VC: Failed to create deviation for note ${noteId}, version ${versionId}.`, error);
            throw error;
        }
    }

    async deleteVersion(noteId: string, versionId: string): Promise<boolean> {
        if (!noteId || !versionId) {
            throw new Error("Invalid noteId or versionId for deleteVersion.");
        }
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions[versionId]) {
                console.warn("VC: Version to delete not found in manifest.");
                return false;
            }

            if (Object.keys(noteManifest.versions).length === 1) {
                return this.deleteAllVersions(noteId);
            }

            await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                delete manifest.versions[versionId];
                manifest.lastModified = new Date().toISOString();
                return manifest;
            });
            
            await this.versionContentRepo.delete(noteId, versionId);

            this.eventBus.trigger('version-deleted', noteId);
            return true;
        } catch (error) {
            console.error(`VC: Failed to delete version ${versionId} for note ${noteId}.`, error);
            throw error;
        }
    }

    async deleteAllVersions(noteId: string): Promise<boolean> {
        if (!noteId) {
            throw new Error("Invalid noteId for deleteAllVersions.");
        }
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const liveFilePath = noteManifest?.notePath;

            await this.manifestManager.deleteNoteEntry(noteId);
            
            if (liveFilePath) {
                await this.cleanupFrontmatter(liveFilePath, noteId);
            }
            
            this.eventBus.trigger('history-deleted', noteId);
            return true;

        } catch (error) {
            console.error(`VC: Failed to delete all versions for note ${noteId}.`, error);
            throw error;
        }
    }

    private async cleanupFrontmatter(filePath: string, expectedNoteId: string): Promise<void> {
        const liveFile = this.app.vault.getAbstractFileByPath(filePath);
        if (liveFile instanceof TFile) {
            const fileCache = this.app.metadataCache.getFileCache(liveFile);
            if (fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] === expectedNoteId) {
                try {
                    await this.app.fileManager.processFrontMatter(liveFile, (fm) => {
                        delete fm[NOTE_FRONTMATTER_KEY];
                    });
                    console.log(`VC: Removed vc-id from frontmatter of "${filePath}" after deleting history.`);
                } catch (fmError) {
                    console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
                }
            }
        }
    }
}
