import { App, TFile, MarkdownView, TFolder } from "obsidian";
import { map, orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { ManifestManager } from "./manifest-manager";
import { NoteManager } from "./note-manager";
import type { VersionHistoryEntry } from "../types";
import { generateUniqueFilePath } from "../utils/file";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";
import { generateUniqueId } from "../utils/id";
import { VersionContentRepository } from "./storage/version-content-repository";
import { TYPES } from "../types/inversify.types";

/**
 * Manages the core business logic for versioning operations like saving,
 * restoring, deleting, and retrieving versions. It orchestrates other services
 * and repositories to perform its tasks.
 */
@injectable()
export class VersionManager {
    constructor(
        @inject(TYPES.App) private app: App, 
        @inject(TYPES.ManifestManager) private manifestManager: ManifestManager, 
        @inject(TYPES.NoteManager) private noteManager: NoteManager, 
        @inject(TYPES.VersionContentRepo) private versionContentRepo: VersionContentRepository,
        @inject(TYPES.EventBus) private eventBus: PluginEvents
    ) {}

    /**
     * Saves a new version of a given file. This method encapsulates the entire
     * process, including getting or creating a note ID, in a more atomic way.
     * @param file The TFile to save a version of.
     * @param name An optional string containing the name for the new version.
     * @param options.force If true, saves the version even if content is identical to the last one.
     * @returns An object indicating if the version was saved or was a duplicate.
     */
    async saveNewVersionForFile(
        file: TFile, 
        name?: string, 
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
                return { status: 'duplicate', newVersionEntry: null, displayName: '', newNoteId: noteId };
            }
        }

        const versionId = generateUniqueId();
        try {
            const { size } = await this.versionContentRepo.write(noteId, versionId, contentToSave);
            const version_name = (name || '').trim();
            const timestamp = new Date().toISOString();

            const updatedManifest = await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
                const versionNumber = (manifest.totalVersions || 0) + 1;
                manifest.versions[versionId] = {
                    versionNumber,
                    timestamp,
                    size,
                    ...(version_name && { name: version_name }),
                };
                manifest.totalVersions = versionNumber;
                manifest.lastModified = timestamp;
                return manifest;
            });

            const savedVersionData = updatedManifest.versions[versionId];
            if (!savedVersionData) {
                throw new Error(`Failed to retrieve saved version data for version ${versionId} from manifest after update.`);
            }

            const displayName = version_name ? `"${version_name}" (V${savedVersionData.versionNumber})` : `Version ${savedVersionData.versionNumber}`;
            this.eventBus.trigger('version-saved', noteId);

            return {
                status: 'saved',
                newVersionEntry: {
                    id: versionId,
                    noteId,
                    notePath: file.path,
                    versionNumber: savedVersionData.versionNumber,
                    timestamp: timestamp,
                    size,
                    ...(version_name && { name: version_name }),
                },
                displayName,
                newNoteId: noteId,
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

    async updateVersionDetails(noteId: string, versionId: string, name: string): Promise<void> {
        if (!noteId || !versionId) {
            throw new Error("Invalid noteId or versionId for updateVersionDetails.");
        }
        
        const version_name = name.trim();

        await this.manifestManager.updateNoteManifest(noteId, (manifest) => {
            const versionData = manifest.versions[versionId];
            if (!versionData) {
                throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);
            }
            if (version_name) {
                versionData.name = version_name;
            } else {
                delete versionData.name;
            }
            manifest.lastModified = new Date().toISOString();
            return manifest;
        });
    }

    async getVersionHistory(noteId: string): Promise<VersionHistoryEntry[]> {
        if (!noteId) return [];
        try {
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            if (!noteManifest || !noteManifest.versions) return [];

            const history = map(noteManifest.versions, (data, id) => ({
                id,
                noteId,
                notePath: noteManifest.notePath,
                versionNumber: data.versionNumber,
                timestamp: data.timestamp,
                size: data.size,
                ...(data.name && { name: data.name }),
            }));

            return orderBy(history, ['versionNumber'], ['desc']);
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
            const versionContent = await this.getVersionContent(noteId, versionId);
            if (versionContent === null) {
                throw new Error("Could not load version content for deviation.");
            }
            
            // Determine new file path
            const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
            const originalFile = noteManifest ? this.app.vault.getAbstractFileByPath(noteManifest.notePath) : null;
            const originalTFile = originalFile instanceof TFile ? originalFile : null;

            const baseName = originalTFile?.basename || 'Untitled Version';
            let parentPath = targetFolder?.isRoot() ? '' : (targetFolder?.path ?? originalTFile?.parent?.path ?? '');
            if (parentPath === '/') parentPath = '';
            
            const newFileNameBase = `${baseName} (from V${versionId.substring(0,6)}...)`;
            const newFilePath = await generateUniqueFilePath(this.app, newFileNameBase, parentPath);

            // Create the new file with the original content (including vc-id)
            const newFile = await this.app.vault.create(newFilePath, versionContent);
            if (!newFile) {
                throw new Error("Failed to create the new note file for deviation.");
            }

            // Now, process the frontmatter of the newly created, permanent file to remove the vc-id
            try {
                await this.app.fileManager.processFrontMatter(newFile, (fm) => {
                    delete fm[NOTE_FRONTMATTER_KEY];
                });
            } catch (error) {
                console.error(`VC: Failed to remove vc-id from new deviation note "${newFilePath}". Deleting the file to prevent issues.`, error);
                // If we can't remove the vc-id, the new file is a clone, which is bad.
                // We should delete it to avoid confusion.
                await this.app.vault.delete(newFile).catch(delErr => {
                    console.error(`VC: CRITICAL: Failed to delete corrupted deviation file "${newFilePath}". Please delete it manually.`, delErr);
                });
                throw new Error(`Failed to create a clean deviation. The file could not be processed after creation.`);
            }

            return newFile;
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
                } catch (fmError) {
                    console.error(`VC: WARNING: Could not clean vc-id from frontmatter of "${filePath}". Please remove it manually.`, fmError);
                }
            }
        }
    }
}
