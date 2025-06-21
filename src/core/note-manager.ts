import { App, TFile, Notice } from "obsidian";
import { ManifestManager } from "./manifest-manager";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { ActiveNoteState } from "../types";
import { generateUniqueId } from "../utils/id";

export class NoteManager {
    private app: App;
    private manifestManager: ManifestManager;
    private centralManifestCache: any | null = null; // Use 'any' to avoid circular dependency issues with CentralManifest type if it were complex

    constructor(app: App, manifestManager: ManifestManager) {
        this.app = app;
        this.manifestManager = manifestManager;
    }

    /**
     * Retrieves the active note and its version control state.
     * It intelligently finds the note's ID, even if it has been removed from the frontmatter.
     */
    async getActiveNoteState(): Promise<ActiveNoteState> {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
            return { file: null, noteId: null };
        }

        // 1. Use metadata cache to get ID from frontmatter
        const cache = this.app.metadataCache.getFileCache(file);
        let noteId = cache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;

        if (noteId) {
            return { file, noteId };
        }

        // 2. If no ID, check manifest by path to recover it
        try {
            if (!this.centralManifestCache) {
                this.centralManifestCache = await this.manifestManager.loadCentralManifest();
            }
            if (!this.centralManifestCache) return { file, noteId: null };

            const foundEntry = Object.entries(this.centralManifestCache.notes).find(
                ([_id, data]: [string, any]) => data.notePath === file.path
            );

            if (foundEntry) {
                noteId = foundEntry[0];
                console.log(`Version Control: Found matching path for ${file.path}. Restoring ID ${noteId} to frontmatter.`);
                try {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        frontmatter[NOTE_FRONTMATTER_KEY] = noteId;
                    });
                    new Notice(`Version control ID for "${file.basename}" was restored.`, 3000);
                } catch (e) {
                    console.error("Version Control: Failed to restore vc-id to frontmatter.", e);
                    new Notice("Error: Could not automatically restore version control ID to note's frontmatter.", 5000);
                }
                return { file, noteId };
            }
        } catch (e) {
            console.error("Version Control: Error while trying to recover note ID from manifest.", e);
        }


        // 3. No ID and no path match, it's a new note for VC
        return { file, noteId: null };
    }

    /**
     * Retrieves or creates a unique note ID stored in frontmatter.
     */
    async getNoteId(file: TFile, createIfNeeded = false): Promise<string | null> {
        if (!file) {
            console.error("Version Control: Invalid file provided to getNoteId");
            return null;
        }

        let noteId: string | null = null;

        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                const id = frontmatter[NOTE_FRONTMATTER_KEY];
                noteId = typeof id === 'string' ? id : null;
            });

            if (!noteId && createIfNeeded) {
                const newId = generateUniqueId();
                await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    frontmatter[NOTE_FRONTMATTER_KEY] = newId;
                });
                noteId = newId;
            }
        } catch (error) {
            console.error(`Version Control: Failed to process frontmatter for note '${file.path}'. Check for syntax errors in the frontmatter.`, error);
            if (createIfNeeded) {
                new Notice("Error: Could not access note frontmatter for version control. Check for syntax errors.", 5000);
            }
            return null;
        }

        return noteId;
    }

    /**
     * Handles the renaming of a note file. It updates the path in the manifests
     * to ensure the version history remains linked to the note.
     * @param file The newly renamed file object.
     * @param oldPath The original path of the file before renaming.
     */
    async handleNoteRename(file: TFile, oldPath: string): Promise<void> {
        try {
            const centralManifest = await this.manifestManager.loadCentralManifest();
            if (!centralManifest) return;

            // Find the noteId by its old path.
            const entry = Object.entries(centralManifest.notes).find(
                ([_id, data]) => data.notePath === oldPath
            );

            if (entry) {
                const [noteId] = entry;
                console.log(`Version Control: Note with ID ${noteId} was renamed from ${oldPath} to ${file.path}. Updating manifests.`);
                
                // Update manifests with the new path.
                await this.manifestManager.updateNotePath(noteId, file.path);
                
                // The manifest has changed, so the cache is now invalid.
                this.invalidateCentralManifestCache();
            }
        } catch (error) {
            console.error(`Version Control: Failed to handle note rename from ${oldPath}.`, error);
            new Notice("Version Control: Error updating path for renamed note.");
        }
    }

    /**
     * Invalidates the internal cache of the central manifest.
     * This should be called whenever the central manifest is modified or could have been modified.
     */
    public invalidateCentralManifestCache() {
        this.centralManifestCache = null;
    }
}