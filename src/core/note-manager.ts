import { App, TFile, WorkspaceLeaf, MarkdownView, FrontMatterCache } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { ActiveNoteInfo } from "../types";
import { generateUniqueId } from "../utils/id";

export class NoteManager {
    private app: App;
    private manifestManager: ManifestManager;

    constructor(app: App, manifestManager: ManifestManager) {
        this.app = app;
        this.manifestManager = manifestManager;
    }

    async getActiveNoteState(leaf?: WorkspaceLeaf | null): Promise<ActiveNoteInfo> {
        const targetLeaf = leaf;

        if (!targetLeaf || !(targetLeaf.view instanceof MarkdownView) || !targetLeaf.view.file) {
            return { file: null, noteId: null, source: 'none' };
        }

        const file = targetLeaf.view.file;
        if (!(file instanceof TFile && file.extension === 'md')) {
            return { file: null, noteId: null, source: 'none' };
        }

        const fileCache = this.app.metadataCache.getFileCache(file);
        let noteIdFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;

        // Treat empty string vc-id as null
        if (typeof noteIdFromFrontmatter === 'string' && noteIdFromFrontmatter.trim() === '') {
            noteIdFromFrontmatter = null;
        }


        if (typeof noteIdFromFrontmatter === 'string') {
            return { file, noteId: noteIdFromFrontmatter, source: 'frontmatter' };
        }

        try {
            const recoveredNoteId = await this.manifestManager.getNoteIdByPath(file.path);
            if (recoveredNoteId) {
                return { file, noteId: recoveredNoteId, source: 'manifest' };
            }
        } catch (manifestError) {
            console.error("Version Control: Error recovering note ID from manifest.", manifestError);
        }

        return { file, noteId: null, source: 'none' };
    }

    async getNoteId(file: TFile): Promise<string | null> {
        if (!file) return null;

        const fileCache = this.app.metadataCache.getFileCache(file);
        let idFromCache = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY];

        if (typeof idFromCache === 'string' && idFromCache.trim() !== '') {
            return idFromCache;
        }
        if (typeof idFromCache === 'string' && idFromCache.trim() === '') {
            // If vc-id is present but empty, treat as if it's not there for getNoteId purposes
            // The auto-reconciliation might pick this up if manifest has an ID.
            return null;
        }
        return null;
    }

    async getOrCreateNoteId(file: TFile): Promise<string | null> {
        const existingId = await this.getNoteId(file);
        if (existingId) {
            const manifestExists = await this.manifestManager.loadNoteManifest(existingId);
            if (!manifestExists) {
                console.warn(`VC: Note "${file.path}" has vc-id "${existingId}" but no manifest. Re-creating entry.`);
                try {
                    await this.manifestManager.createNoteEntry(existingId, file.path);
                } catch (recreateError) {
                    console.error(`VC: Failed to repair missing manifest for existing vc-id "${existingId}".`, recreateError);
                    throw new Error(`Could not repair version history for "${file.basename}".`);
                }
            }
            return existingId;
        }

        const newId = generateUniqueId();
        const writeSuccess = await this.writeNoteIdToFrontmatter(file, newId);

        if (writeSuccess) {
            try {
                await this.manifestManager.createNoteEntry(newId, file.path);
                return newId;
            } catch (manifestError) {
                console.error(`VC: Wrote vc-id ${newId} to frontmatter but failed to create manifest entry for "${file.path}". Rolling back frontmatter.`, manifestError);
                
                try {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontMatterCache) => {
                        if (frontmatter[NOTE_FRONTMATTER_KEY] === newId) {
                            delete frontmatter[NOTE_FRONTMATTER_KEY];
                        }
                    });
                    console.log(`VC: Successfully rolled back vc-id write from frontmatter of "${file.path}".`);
                } catch (rollbackError) {
                    console.error(`VC: CRITICAL: Failed to roll back vc-id from frontmatter of "${file.path}". Note may be inconsistent. Manually remove "vc-id: ${newId}".`, rollbackError);
                    throw new Error(`CRITICAL! Failed to clean vc-id in "${file.basename}". Remove it manually.`);
                }
                throw new Error(`Failed to initialize version history for "${file.basename}". Rolled back.`);
            }
        }
        return null; // Failed to write to frontmatter
    }

    async writeNoteIdToFrontmatter(file: TFile, noteId: string): Promise<boolean> {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontMatterCache) => {
                frontmatter[NOTE_FRONTMATTER_KEY] = noteId;
            });
            console.log(`VC: Wrote vc-id "${noteId}" to frontmatter for note "${file.path}".`);
            return true;
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to write vc-id to frontmatter for '${file.path}'. Frontmatter might be invalid.`, error);
            throw new Error(`Could not save vc-id to "${file.basename}". Check note's frontmatter.`);
        }
    }

    async handleNoteRename(file: TFile, oldPath: string): Promise<void> {
        try {
            const noteIdToUpdate = await this.manifestManager.getNoteIdByPath(oldPath);

            if (noteIdToUpdate) {
                console.log(`VC: Note ID ${noteIdToUpdate} renamed/moved from "${oldPath}" to "${file.path}". Updating manifests.`);
                await this.manifestManager.updateNotePath(noteIdToUpdate, file.path);
            } else {
                this.manifestManager.invalidateCentralManifestCache();
                console.log(`VC: Note renamed from "${oldPath}" to "${file.path}", but no existing vc-id found by old path. No manifest update needed for this ID.`);
            }
        } catch (error) {
            console.error(`VC: Failed to handle note rename from "${oldPath}" to "${file.path}".`, error);
            // Don't throw, just log. The system can recover on next load.
        }
    }

    public invalidateCentralManifestCache(): void {
        this.manifestManager.invalidateCentralManifestCache();
    }
}
