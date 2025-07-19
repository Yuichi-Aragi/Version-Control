import { App, TFile, WorkspaceLeaf, MarkdownView } from "obsidian";
import type { FrontMatterCache } from "obsidian";
import { injectable, inject } from 'inversify';
import { ManifestManager } from "./manifest-manager";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import type { ActiveNoteInfo } from "../types";
import { generateUniqueId } from "../utils/id";
import { TYPES } from "../types/inversify.types";

@injectable()
export class NoteManager {
    constructor(
        @inject(TYPES.App) private app: App, 
        @inject(TYPES.ManifestManager) private manifestManager: ManifestManager
    ) {}

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
        // This operation is now inherently safe because the underlying repository
        // methods in ManifestManager are queued.
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

        // Safer order: Create manifest entry first, then write to frontmatter.
        const newId = generateUniqueId();
        try {
            // Step 1: Create the manifest entry. This is the critical, now-queued operation.
            await this.manifestManager.createNoteEntry(newId, file.path);

            // Step 2: If manifest creation succeeds, write the ID to the note's frontmatter.
            const writeSuccess = await this.writeNoteIdToFrontmatter(file, newId);
            if (!writeSuccess) {
                // This is a non-critical failure. The history exists but is "orphaned".
                // It can be reconciled later. Log a clear warning.
                console.warn(`VC: Created manifest for note "${file.path}" (ID: ${newId}) but failed to write vc-id to its frontmatter. The history is saved but the note needs reconciliation.`);
                throw new Error(`Failed to initialize version history for "${file.basename}". History was created but could not be linked to the note.`);
            }
            return newId;

        } catch (error) {
            console.error(`VC: Failed to get or create note ID for "${file.path}".`, error);
            // The manifest manager's createNoteEntry already handles its own rollback.
            // We just need to re-throw the error to the caller.
            throw new Error(`Failed to initialize version history for "${file.basename}". Please try again.`);
        }
    }

    async writeNoteIdToFrontmatter(file: TFile, noteId: string): Promise<boolean> {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontMatterCache) => {
                frontmatter[NOTE_FRONTMATTER_KEY] = noteId;
            });
            return true;
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to write vc-id to frontmatter for '${file.path}'. Frontmatter might be invalid.`, error);
            throw new Error(`Could not save vc-id to "${file.basename}". Check note's frontmatter.`);
        }
    }

    async handleNoteRename(file: TFile, oldPath: string): Promise<void> {
        // This operation is now inherently safe because the underlying repository
        // methods in ManifestManager are queued.
        try {
            const noteIdToUpdate = await this.manifestManager.getNoteIdByPath(oldPath);

            if (noteIdToUpdate) {
                await this.manifestManager.updateNotePath(noteIdToUpdate, file.path);
            } else {
                // If no ID was found for the old path, there's nothing to update in our DB,
                // but we should still invalidate the central manifest cache in case it was stale.
                this.manifestManager.invalidateCentralManifestCache();
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
