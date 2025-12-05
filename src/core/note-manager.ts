import { App, TFile, WorkspaceLeaf, MarkdownView, type FrontMatterCache, FileView } from "obsidian";
import { injectable, inject } from 'inversify';
import { ManifestManager } from "./manifest-manager";
import type { ActiveNoteInfo } from "../types";
import { generateNoteId, extractUuidFromId, extractTimestampFromId } from "../utils/id";
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

        if (!targetLeaf || !(targetLeaf.view instanceof FileView) || !targetLeaf.view.file) {
            return { file: null, noteId: null, source: 'none' };
        }

        const file = targetLeaf.view.file;
        if (!(file instanceof TFile)) {
            return { file: null, noteId: null, source: 'none' };
        }

        if (file.extension === 'base') {
            return { file, noteId: file.path, source: 'filepath' };
        }

        if (file.extension === 'md') {
            if (!(targetLeaf.view instanceof MarkdownView)) {
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
        return { file: null, noteId: null, source: 'none' };
    }

    async getNoteId(file: TFile): Promise<string | null> {
        if (!file) return null;

        if (file.extension === 'base') {
            return file.path;
        }

        if (file.extension === 'md') {
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
        }
        return null;
    }

    /**
     * Ensures a note has a version control ID.
     * For .md files, it ensures the ID is in the frontmatter.
     * For .base files, it returns the file path.
     * This method does NOT create any database entries; that is deferred until the first save.
     * @param file The TFile to get or create an ID for.
     * @returns The note's version control ID, or null if one couldn't be assigned.
     */
    async getOrCreateNoteId(file: TFile): Promise<string | null> {
        if (file.extension === 'base') {
            return file.path;
        }

        if (file.extension === 'md') {
            const existingId = await this.getNoteId(file);
            if (existingId) {
                // The manifest existence will be checked later by the VersionManager during save.
                // This method's only job is to ensure an ID is present in the frontmatter.
                return existingId;
            }

            // If no ID, generate one based on settings and write it to the file.
            // We use the new generateNoteId which respects the noteIdFormat setting.
            let newId = generateNoteId(this.plugin.settings, file);
            
            // Ensure uniqueness
            newId = await this.manifestManager.ensureUniqueNoteId(newId);

            try {
                await this.writeNoteIdToFrontmatter(file, newId);
                return newId;
            } catch (error) {
                console.error(`VC: Failed to write new vc-id to frontmatter for "${file.path}".`, error);
                // If we can't write the ID, we can't proceed with versioning.
                throw new Error(`Failed to initialize version history for "${file.basename}". Could not write to frontmatter.`);
            }
        }
        return null;
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
        try {
            const noteIdToUpdate = await this.manifestManager.getNoteIdByPath(oldPath);

            if (noteIdToUpdate) {
                const settings = this.plugin.settings;
                
                // We need to update the ID to reflect the new path
                // Try to preserve timestamp if possible.
                let timestamp: string | undefined = extractTimestampFromId(noteIdToUpdate) ?? undefined;
                
                if (!timestamp) {
                    // Fallback to manifest creation time if extraction fails
                    const noteManifest = await this.manifestManager.loadNoteManifest(noteIdToUpdate);
                    if (noteManifest && noteManifest.createdAt) {
                        timestamp = new Date(noteManifest.createdAt).getTime().toString();
                    }
                }

                // Try to preserve UUID if possible
                const oldUuid = extractUuidFromId(noteIdToUpdate);

                const candidateNewId = generateNoteId(settings, file, timestamp, oldUuid);

                if (candidateNewId !== noteIdToUpdate) {
                    const uniqueNewId = await this.manifestManager.ensureUniqueNoteId(candidateNewId);
                    
                    // Perform the rename operation (Folder rename + Manifest updates)
                    await this.manifestManager.renameNoteEntry(noteIdToUpdate, uniqueNewId);
                    
                    // Update the frontmatter in the file
                    await this.writeNoteIdToFrontmatter(file, uniqueNewId);
                    
                    // We also need to update the path in the manifest (which is now under new ID)
                    await this.manifestManager.updateNotePath(uniqueNewId, file.path);
                    
                    return; // Done
                }

                // If ID didn't change, just update the path mapping
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

    /**
     * Checks if the current note ID matches the expected ID format based on the file path.
     * If there's a mismatch, it triggers an update.
     * @param file The active file.
     * @param currentId The current ID found in frontmatter.
     */
    async verifyNoteIdMatchesPath(file: TFile, currentId: string): Promise<void> {
        const settings = this.plugin.settings;

        try {
            // We need to see if the current ID matches what we'd expect for this path.
            // We extract components from the current ID to reconstruct the expected ID.
            
            // Extract Timestamp
            let timestamp: string | undefined = extractTimestampFromId(currentId) ?? undefined;
            if (!timestamp) {
                const noteManifest = await this.manifestManager.loadNoteManifest(currentId);
                if (noteManifest && noteManifest.createdAt) {
                    timestamp = new Date(noteManifest.createdAt).getTime().toString();
                }
            }

            // Extract UUID
            const currentUuid = extractUuidFromId(currentId);

            const expectedId = generateNoteId(settings, file, timestamp, currentUuid);

            // If the ID is different, we should update it to match the current path
            if (currentId !== expectedId) {
                console.log(`VC: Note ID mismatch detected for "${file.path}". Updating ID from "${currentId}" to "${expectedId}".`);
                const uniqueNewId = await this.manifestManager.ensureUniqueNoteId(expectedId);
                
                await this.manifestManager.renameNoteEntry(currentId, uniqueNewId);
                await this.writeNoteIdToFrontmatter(file, uniqueNewId);
                await this.manifestManager.updateNotePath(uniqueNewId, file.path);
            }
        } catch (error) {
            console.error(`VC: Error verifying note ID match for "${file.path}".`, error);
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
