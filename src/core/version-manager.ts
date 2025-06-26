import { App, TFile, MarkdownView, FrontMatterCache, TFolder } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NoteManager } from "./note-manager";
import { VersionHistoryEntry, NoteManifest } from "../types";
import { removeFrontmatterKey, generateUniqueFilePath } from "../utils/file";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";
import { generateUniqueId } from "../utils/id";

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
        const tags: string[] = [];
        const name = input.replace(/(?:^|\s)#([^\s#]+)/g, (match, tag) => {
            tags.push(tag);
            return ' ';
        }).replace(/\s+/g, ' ').trim();

        const finalTags = [...new Set(tags)].slice(0, 5); // Unique tags, max 5
        return { name, tags: finalTags };
    }

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
        let contentToSave: string;

        if (activeMarkdownView && activeMarkdownView.file && activeMarkdownView.file.path === file.path) {
            contentToSave = activeMarkdownView.editor.getValue();
        } else {
            contentToSave = await this.app.vault.cachedRead(file);
        }

        // Check for duplicate content, unless forced
        if (!force && noteManifest.totalVersions > 0) {
            const history = await this.getVersionHistory(noteId);
            if (history.length > 0) {
                const latestVersion = history[0]; // Already sorted desc by version number
                const latestContent = await this.getVersionContent(noteId, latestVersion.id);
                if (latestContent !== null && latestContent === contentToSave) {
                    console.log(`VC: Content for "${file.path}" is identical to the latest version. Skipping save.`);
                    return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
                }
            }
        }

        const versionId = generateUniqueId();
        const finalVersionFilePath = this.manifestManager.getNoteVersionPath(noteId, versionId);

        try {
            // Safer order: 1. Write file. 2. Update manifest.
            // This prevents the manifest from pointing to a non-existent file.
            await this.app.vault.adapter.write(finalVersionFilePath, contentToSave);

            let fileSize = contentToSave.length;
            try {
                const stats = await this.app.vault.adapter.stat(finalVersionFilePath);
                fileSize = stats?.size ?? fileSize;
            } catch (statError) {
                console.warn(`VC: Could not get file stats for ${finalVersionFilePath}. Using content length.`, statError);
            }

            const { name, tags } = this._parseNameAndTags(nameAndTags || '');
            const timestamp = new Date().toISOString();

            const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                const versionNumber = (manifest.totalVersions || 0) + 1;
                
                const versionData = {
                    versionNumber,
                    timestamp,
                    name: name || undefined,
                    tags: tags.length > 0 ? tags : undefined,
                    size: fileSize,
                };

                manifest.versions[versionId] = versionData;
                manifest.totalVersions = versionNumber;
                manifest.lastModified = timestamp;
                
                return manifest;
            });

            const savedVersionData = updatedManifest.versions[versionId];
            const savedVersionNumber = savedVersionData.versionNumber;

            const displayName = name ? `"${name}" (V${savedVersionNumber})` : `Version ${savedVersionNumber}`;
            this.eventBus.trigger('version-saved', noteId);

            return {
                status: 'saved',
                newVersionEntry: {
                    id: versionId,
                    noteId,
                    notePath: file.path,
                    versionNumber: savedVersionNumber,
                    timestamp: timestamp,
                    name: name || undefined,
                    tags: tags.length > 0 ? tags : undefined,
                    size: fileSize,
                },
                displayName,
                newNoteId: noteId,
            };

        } catch (error) {
            console.error(`VC: CRITICAL FAILURE in saveNewVersionForFile for "${file.path}". Rolling back.`, error);
            // If the process failed, try to clean up the version file that might have been created.
            if (await this.app.vault.adapter.exists(finalVersionFilePath)) {
                try {
                    await this.app.vault.adapter.remove(finalVersionFilePath);
                    console.log(`VC: Successfully cleaned up orphaned version file: ${finalVersionFilePath}`);
                } catch (cleanupError) {
                    console.error(`VC: FAILED to clean up orphaned version file after an error: ${finalVersionFilePath}`, cleanupError);
                }
            }
            // Invalidate the note manifest cache to ensure it's re-read fresh next time, in case it was partially modified in memory.
            this.manifestManager.invalidateNoteManifestCache(noteId);
            throw error;
        }
    }

    async updateVersionDetails(noteId: string, versionId: string, nameAndTags: string): Promise<void> {
        if (!noteId || !versionId) {
            throw new Error("Invalid noteId or versionId for updateVersionDetails.");
        }
        
        const { name, tags } = this._parseNameAndTags(nameAndTags);

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
        if (!noteId || !versionId) return null;
        try {
            const versionFilePath = this.manifestManager.getNoteVersionPath(noteId, versionId);
            if (!await this.app.vault.adapter.exists(versionFilePath)) {
                // Attempt to load manifest to double-check before erroring
                const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
                const versionData = noteManifest?.versions?.[versionId];
                if (!versionData) {
                    console.error(`VC: Version ${versionId} not found in manifest for note ${noteId}.`);
                    return null;
                }
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
            
            await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                if (manifest.versions[versionId]) {
                    delete manifest.versions[versionId];
                    manifest.lastModified = new Date().toISOString();
                }
                return manifest;
            });
            
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
            const liveFilePath = noteManifest?.notePath; // Get path before deleting manifest data

            // Step 1: Delete the core data and central manifest entry. This is the critical part.
            // This will throw if it fails, preventing the frontmatter from being changed.
            await this.manifestManager.deleteNoteEntry(noteId);
            
            // Step 2: If data deletion was successful, clean up the frontmatter in the live file.
            if (liveFilePath) {
                const liveFile = this.app.vault.getAbstractFileByPath(liveFilePath);
                if (liveFile instanceof TFile) {
                    const fileCache = this.app.metadataCache.getFileCache(liveFile);
                    const idFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;

                    if (idFromFrontmatter === noteId) {
                        try {
                            await this.app.fileManager.processFrontMatter(liveFile, (frontmatter: FrontMatterCache) => {
                                delete frontmatter[NOTE_FRONTMATTER_KEY];
                            });
                            console.log(`VC: Removed vc-id from frontmatter of "${liveFile.path}" after deleting history.`);
                        } catch (fmError) {
                            // This is not a critical failure. The data is gone. Log a clear message for the user.
                            console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${liveFile.path}" after history deletion. Please remove it manually. This is not a data-loss issue.`, fmError);
                            // We don't re-throw here. The main operation succeeded.
                        }
                    }
                }
            }
            
            this.eventBus.trigger('history-deleted', noteId);
            return true;

        } catch (error) {
            console.error(`VC: Failed to delete all versions for note ${noteId}.`, error);
            throw error; // Re-throw so the thunk can catch it and show an error notice.
        }
    }
}
