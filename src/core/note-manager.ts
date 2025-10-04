import { App, TFile, WorkspaceLeaf, MarkdownView, type FrontMatterCache } from "obsidian";
import { injectable, inject } from 'inversify';
import { ManifestManager } from "./manifest-manager";
import type { ActiveNoteInfo } from "../types";
import { generateUniqueId } from "../utils/id";
import { TYPES } from "../types/inversify.types";
import type VersionControlPlugin from "../main";

@injectable()
export class NoteManager {
    // A temporary exclusion list to prevent event handlers from processing files
    // that are in the middle of a special creation process (e.g., deviations).
    private pendingDeviations = new Set<string>();

    constructor(
        @inject(TYPES.Plugin) private plugin: VersionControlPlugin,
        @inject(TYPES.App) private app: App, 
        @inject(TYPES.ManifestManager) private manifestManager: ManifestManager
    ) {}

    private get noteIdKey(): string {
        return this.plugin.settings.noteIdFrontmatterKey;
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
        let noteIdFromFrontmatter = fileCache?.frontmatter?.[this.noteIdKey] ?? null;

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
        let idFromCache = fileCache?.frontmatter?.[this.noteIdKey];

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

    /**
     * Ensures a note has a version control ID in its frontmatter.
     * If an ID already exists, it's returned. If not, a new ID is generated,
     * written to the note's frontmatter, and then returned.
     * This method does NOT create any database entries; that is deferred until the first save.
     * @param file The TFile to get or create an ID for.
     * @returns The note's version control ID, or null if one couldn't be assigned.
     */
    async getOrCreateNoteId(file: TFile): Promise<string | null> {
        const existingId = await this.getNoteId(file);
        if (existingId) {
            // The manifest existence will be checked later by the VersionManager during save.
            // This method's only job is to ensure an ID is present in the frontmatter.
            return existingId;
        }

        // If no ID, create one and write it to the file.
        const newId = generateUniqueId();
        try {
            await this.writeNoteIdToFrontmatter(file, newId);
            return newId;
        } catch (error) {
            console.error(`VC: Failed to write new vc-id to frontmatter for "${file.path}".`, error);
            // If we can't write the ID, we can't proceed with versioning.
            throw new Error(`Failed to initialize version history for "${file.basename}". Could not write to frontmatter.`);
        }
    }

    async writeNoteIdToFrontmatter(file: TFile, noteId: string): Promise<boolean> {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontMatterCache) => {
                frontmatter[this.noteIdKey] = noteId;
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

    // --- Deviation Exclusion List Methods ---

    public addPendingDeviation(path: string): void {
        this.pendingDeviations.add(path);
    }

    public removePendingDeviation(path: string): void {
        this.pendingDeviations.delete(path);
    }

    public isPendingDeviation(path: string): boolean {
        return this.pendingDeviations.has(path);
    }
}