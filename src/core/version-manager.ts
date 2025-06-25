import { App, TFile, MarkdownView, FrontMatterCache, TFolder } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NoteManager } from "./note-manager";
import { VersionHistoryEntry, NoteManifest } from "../types";
import { removeFrontmatterKey, generateUniqueFilePath } from "../utils/file";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";

/**
 * Manages the core business logic for versioning operations like saving,
 * restoring, deleting, and retrieving versions. It interacts with the
 * manifest and note managers and emits events to signal changes.
 */
export class VersionManager {
    private app: App;
    private manifestManager: ManifestManager;
    private noteManager: NoteManager;
    private eventBus: PluginEvents;

    constructor(
        app: App, 
        manifestManager: ManifestManager, 
        noteManager: NoteManager, 
        eventBus: PluginEvents
    ) {
        this.app = app;
        this.manifestManager = manifestManager;
        this.noteManager = noteManager;
        this.eventBus = eventBus;
    }

    /**
     * Parses a string to extract a name and up to 5 tags.
     * @param input The raw string from the user, e.g., "My changes #important #refactor"
     * @returns An object with `name` and `tags` properties.
     */
    private _parseNameAndTags(input: string): { name: string, tags: string[] } {
        const tagsRegex = /(?:^|\s)#([^\s#]+)/g;
        const tags: string[] = [];
        let match;
        // Use a non-mutating exec loop
        const cleanInput = input;
        while ((match = tagsRegex.exec(cleanInput)) !== null) {
            tags.push(match[1]);
        }
        const name = input.replace(tagsRegex, '').trim();
        const finalTags = [...new Set(tags)].slice(0, 5); // Unique tags, max 5

        return { name, tags: finalTags };
    }

    /**
     * Saves a new version of a given file. This method encapsulates the entire
     * process, including getting or creating a note ID.
     * @param file The TFile to save a version of.
     * @param nameAndTags An optional string containing the name and tags for the new version.
     * @returns An object containing the new version entry, a display name, and the note ID.
     */
    async saveNewVersionForFile(file: TFile, nameAndTags?: string): Promise<{ newVersionEntry: VersionHistoryEntry, displayName: string, newNoteId: string }> {
        if (!file) {
            throw new Error("Invalid file provided to saveNewVersionForFile.");
        }

        try {
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
            let contentToSave: string;

            if (activeMarkdownView && activeMarkdownView.file && activeMarkdownView.file.path === file.path) {
                contentToSave = activeMarkdownView.editor.getValue();
            } else {
                contentToSave = await this.app.vault.cachedRead(file);
            }

            const versionNumber = (noteManifest.totalVersions || 0) + 1;
            const versionId = `v${versionNumber}_${Date.now()}`; 
            const timestamp = new Date().toISOString();
            const versionFilePath = this.manifestManager.getNoteVersionPath(noteId, versionId);

            await this.app.vault.adapter.write(versionFilePath, contentToSave);
            
            let fileSize = contentToSave.length; 
            try {
                const stats = await this.app.vault.adapter.stat(versionFilePath);
                fileSize = stats?.size ?? fileSize;
            } catch (statError) {
                console.warn(`VC: Could not get file stats for ${versionFilePath}. Using content length.`, statError);
            }

            const { name, tags } = this._parseNameAndTags(nameAndTags || '');

            const versionData = {
                versionNumber, timestamp, 
                name: name || undefined,
                tags: tags.length > 0 ? tags : undefined,
                filePath: versionFilePath, size: fileSize,
            };
            noteManifest.versions[versionId] = versionData;
            noteManifest.totalVersions = versionNumber;
            noteManifest.lastModified = timestamp;

            await this.manifestManager.saveNoteManifest(noteManifest);
            
            const displayName = name ? `"${name}" (V${versionNumber})` : `Version ${versionNumber}`;

            // Emit an event to notify other parts of the system (like CleanupManager)
            this.eventBus.trigger('version-saved', noteId);
            
            return {
                newVersionEntry: {
                    id: versionId,
                    noteId,
                    notePath: file.path,
                    versionNumber: versionData.versionNumber,
                    timestamp: versionData.timestamp,
                    name: versionData.name,
                    tags: versionData.tags,
                    size: versionData.size,
                },
                displayName,
                newNoteId: noteId,
            };

        } catch (error) {
            console.error(`VC: CRITICAL FAILURE in saveNewVersionForFile for "${file.path}".`, error);
            throw error;
        }
    }

    async updateVersionDetails(noteId: string, versionId: string, nameAndTags: string): Promise<void> {
        if (!noteId || !versionId) {
            throw new Error("Invalid noteId or versionId for updateVersionDetails.");
        }
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions[versionId]) {
                throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);
            }

            const { name, tags } = this._parseNameAndTags(nameAndTags);

            noteManifest.versions[versionId].name = name || undefined;
            noteManifest.versions[versionId].tags = tags.length > 0 ? tags : undefined;
            noteManifest.lastModified = new Date().toISOString();

            await this.manifestManager.saveNoteManifest(noteManifest);
            console.log(`VC: Updated details for version ${versionId} to name: "${name}", tags: [${tags.join(', ')}].`);
        } catch (error) {
            console.error(`VC: Failed to update details for version ${versionId}.`, error);
            throw error;
        }
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
        if (!noteId || !versionId) return null;
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const versionData = noteManifest?.versions?.[versionId];
            if (!versionData) {
                console.error(`VC: Version ${versionId} not found in manifest for note ${noteId}.`);
                return null;
            }

            const versionFilePath = this.manifestManager.getNoteVersionPath(noteId, versionId);
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
            versionContent = removeFrontmatterKey(versionContent, NOTE_FRONTMATTER_KEY);

            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const originalFile = noteManifest ? this.app.vault.getAbstractFileByPath(noteManifest.notePath) : null;
            const originalTFile = originalFile instanceof TFile ? originalFile : null;

            const baseName = originalTFile?.basename || 'Untitled Version';
            let parentPath = ''; // Vault root by default
            if (targetFolder) {
                parentPath = targetFolder.isRoot() ? '' : targetFolder.path;
            } else if (originalTFile?.parent && !originalTFile.parent.isRoot()) {
                parentPath = originalTFile.parent.path;
            }
            
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
                return false; // Not an error, just nothing to do.
            }

            if (Object.keys(noteManifest.versions).length === 1 && noteManifest.versions[versionId]) {
                console.log(`VC: Deleting last version (${versionId}) for note ${noteId}. Triggering deleteAllVersions.`);
                return this.deleteAllVersions(noteId);
            }

            const versionFilePath = this.manifestManager.getNoteVersionPath(noteId, versionId);
            delete noteManifest.versions[versionId]; 
            noteManifest.lastModified = new Date().toISOString();
            await this.manifestManager.saveNoteManifest(noteManifest); 
            
            if (await this.app.vault.adapter.exists(versionFilePath)) {
                await this.app.vault.adapter.remove(versionFilePath);
            } else {
                console.warn(`VC: Version file to delete was already missing: ${versionFilePath}`);
            }

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
            if (!noteManifest) {
                console.log("VC: No version history found for this note to delete.");
                await this.manifestManager.deleteNoteEntry(noteId); // Cleanup central manifest
                return true; 
            }

            const liveFilePath = noteManifest.notePath;
            const liveFile = this.app.vault.getAbstractFileByPath(liveFilePath); 

            if (liveFile instanceof TFile) {
                const fileCache = this.app.metadataCache.getFileCache(liveFile);
                const idFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;

                if (idFromFrontmatter === noteId) {
                    try {
                        await this.app.fileManager.processFrontMatter(liveFile, (frontmatter: FrontMatterCache) => {
                            delete frontmatter[NOTE_FRONTMATTER_KEY];
                        });
                        console.log(`VC: Removed vc-id from frontmatter of "${liveFile.path}" before deleting history.`);
                    } catch (fmError) {
                        console.error(`VC: CRITICAL: Could not clean vc-id from frontmatter of "${liveFile.path}". Aborting history deletion. Fix frontmatter and retry.`, fmError);
                        throw new Error(`Could not remove vc-id from "${liveFile.basename}". History deletion aborted. Check frontmatter.`);
                    }
                } else {
                    console.log(`VC: Skipped frontmatter cleanup for "${liveFile.path}". Its vc-id ("${idFromFrontmatter}") doesn't match history being deleted ("${noteId}").`);
                }
            } else {
                console.log(`VC: Note at path "${liveFilePath}" (from manifest) not found. Proceeding to delete history data for ID ${noteId}.`);
            }

            await this.manifestManager.deleteNoteEntry(noteId);
            this.eventBus.trigger('history-deleted', noteId);
            return true;

        } catch (error) {
            console.error(`VC: Failed to delete all versions for note ${noteId}.`, error);
            throw error;
        }
    }
}
