import { App, TFile, WorkspaceLeaf, MarkdownView, FileView } from "obsidian";
import { ManifestManager } from "@/core";
import type { ActiveNoteInfo } from "@/types";
import { generateNoteId, extractUuidFromId, extractTimestampFromId } from "@/utils/id";
import type VersionControlPlugin from "@/main";
import { EditHistoryManager } from "@/core";
import { updateFrontmatter, getFrontmatterKey, DELETE } from "@/utils/frontmatter";
import { PluginEvents } from "@/core/plugin-events";

export class NoteManager {
    // A temporary exclusion list to prevent event handlers from processing files
    // that are in the middle of a special creation process (e.g., deviations).
    private pendingDeviations = new Set<string>();

    // A temporary exclusion list for files undergoing internal frontmatter updates.
    // This prevents infinite loops where the plugin's own writes trigger 'modify' events.
    private internalWriteIgnoreSet = new Set<string>();

    constructor(
        private plugin: VersionControlPlugin,
        private app: App, 
        private manifestManager: ManifestManager,
        private editHistoryManager: EditHistoryManager,
        private eventBus: PluginEvents
    ) {}

    private get noteIdKey(): string {
        return this.plugin.settings.noteIdFrontmatterKey;
    }

    private get legacyNoteIdKeys(): string[] {
        return this.plugin.settings.legacyNoteIdFrontmatterKeys || [];
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

        // Check pending deviation status to prevent race conditions during creation
        if (this.isPendingDeviation(file.path)) {
            return { file, noteId: null, source: 'none' };
        }

        if (file.extension === 'base') {
            // For .base files, we must retrieve the ID consistently using getNoteId logic
            // which handles manifest lookups and sanitization.
            const noteId = await this.getNoteId(file);
            if (noteId) {
                return { file, noteId, source: 'filepath' };
            }
            // If getNoteId returns null (unlikely for .base unless error), fallback to path but it might mismatch
            return { file, noteId: file.path, source: 'filepath' };
        }

        if (file.extension === 'md') {
            if (!(targetLeaf.view instanceof MarkdownView)) {
                return { file: null, noteId: null, source: 'none' };
            }

            // Use getNoteId to handle both primary and legacy keys
            const noteId = await this.getNoteId(file);

            if (noteId) {
                return { file, noteId, source: 'frontmatter' };
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

        // Check pending deviation status
        if (this.isPendingDeviation(file.path)) {
            return null;
        }

        // 1. Priority: Check Central Manifest for existing ID associated with this path.
        // This includes consolidation logic to ensure only one ID exists per path.
        const { winnerId, loserIds } = await this.manifestManager.resolveDuplicatesForPath(file.path);

        // Handle cleanup of losers (Edit History & Timeline)
        if (loserIds.length > 0) {
            console.log(`VC: Cleaning up external data for duplicate IDs: ${loserIds.join(', ')}`);
            for (const loserId of loserIds) {
                // Delete Edit History (IDB)
                await this.editHistoryManager.deleteNoteHistory(loserId).catch(e => 
                    console.error(`VC: Failed to delete edit history for duplicate ${loserId}`, e)
                );
                // Clear Timeline
                this.eventBus.trigger('history-deleted', loserId);
            }
        }

        if (winnerId) {
            // If we found a canonical ID for this path, we enforce it.
            if (file.extension === 'md') {
                const fileCache = this.app.metadataCache.getFileCache(file);
                const currentFmId = fileCache?.frontmatter?.[this.noteIdKey];
                
                // Check if any legacy keys are present in the file
                const hasLegacyKeys = this.legacyNoteIdKeys.some(key => 
                    fileCache?.frontmatter?.[key] !== undefined
                );
                
                // If frontmatter ID doesn't match canonical ID OR legacy keys exist, update/clean.
                // This handles cases where file content might have been overwritten, is stale, or contains deprecated keys.
                if (currentFmId !== winnerId || hasLegacyKeys) {
                    await this.writeNoteIdToFrontmatter(file, winnerId);
                }
            }
            return winnerId;
        }

        // 2. Fallback: If no canonical ID in manifest, check frontmatter/generation logic.
        if (file.extension === 'base') {
            // For .base files, if not in manifest, we generate one (but don't save to manifest yet)
            return generateNoteId(this.plugin.settings, file);
        }

        let noteId: string | null = null;

        if (file.extension === 'md') {
            const fileCache = this.app.metadataCache.getFileCache(file);
            const frontmatter = fileCache?.frontmatter;

            // Check Primary Key
            let id = frontmatter?.[this.noteIdKey];
            if (this.isValidId(id)) {
                noteId = id;
            } else {
                // Check Legacy Keys
                for (const legacyKey of this.legacyNoteIdKeys) {
                    id = frontmatter?.[legacyKey];
                    if (this.isValidId(id)) {
                        // Found valid ID in legacy key. Migrate it silently.
                        await this.migrateLegacyKey(file, legacyKey, this.noteIdKey, id).catch(e => 
                            console.error(`VC: Failed to migrate legacy key '${legacyKey}' to '${this.noteIdKey}' for file '${file.path}'`, e)
                        );
                        noteId = id;
                        break;
                    }
                }
            }
        }

        if (noteId) {
            await this.ensurePathConsistency(noteId, file.path);
        }

        return noteId;
    }

    private async ensurePathConsistency(noteId: string, currentPath: string): Promise<void> {
        try {
            const centralManifest = await this.manifestManager.loadCentralManifest();
            const noteEntry = centralManifest.notes[noteId];

            if (noteEntry && noteEntry.notePath !== currentPath) {
                console.log(`VC: External move detected for note "${noteId}". Updating path from "${noteEntry.notePath}" to "${currentPath}".`);
                
                // 1. Update Version History (Central + Note Manifests)
                await this.manifestManager.updateNotePath(noteId, currentPath);
                
                // 2. Update Edit History (IndexedDB + Edit Manifest)
                await this.editHistoryManager.updateNotePath(noteId, currentPath);
            }
        } catch (error) {
            console.error(`VC: Failed to ensure path consistency for note ${noteId}`, error);
        }
    }

    private isValidId(id: any): id is string {
        return typeof id === 'string' && id.trim() !== '';
    }

    private async migrateLegacyKey(file: TFile, oldKey: string, newKey: string, value: string): Promise<void> {
        try {
            // Check existence and value match before attempting update
            const currentVal = await getFrontmatterKey(this.app, file, oldKey);
            
            if (currentVal.success && currentVal.data === value) {
                // Register internal write to prevent event loop
                this.registerInternalWrite(file.path);
                
                const result = await updateFrontmatter(this.app, file, {
                    [oldKey]: DELETE,
                    [newKey]: value
                });
                
                if (!result.success) {
                    throw result.error || new Error(`Failed to migrate legacy key ${oldKey}`);
                }
            }
        } catch (error) {
            console.error(`VC: Error migrating legacy key for ${file.path}`, error);
        }
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
        // Use getNoteId to leverage manifest lookup + consolidation logic
        const existingId = await this.getNoteId(file);
        if (existingId) {
            return existingId;
        }

        if (file.extension === 'md') {
            // If no ID, generate one based on settings and write it to the file.
            let newId = generateNoteId(this.plugin.settings, file);
            
            // Ensure uniqueness
            newId = await this.manifestManager.ensureUniqueNoteId(newId);

            try {
                await this.writeNoteIdToFrontmatter(file, newId);
                return newId;
            } catch (error) {
                console.error(`VC: Failed to write new vc-id to frontmatter for "${file.path}".`, error);
                throw new Error(`Failed to initialize version history for "${file.basename}". Could not write to frontmatter.`);
            }
        }
        return null;
    }

    async writeNoteIdToFrontmatter(file: TFile, noteId: string): Promise<boolean> {
        try {
            // Register internal write to prevent event loop
            this.registerInternalWrite(file.path);

            const updates: Record<string, any> = {
                [this.noteIdKey]: noteId
            };
            
            // Also clean up any legacy keys if they exist, just in case
            for (const legacyKey of this.legacyNoteIdKeys) {
                updates[legacyKey] = DELETE;
            }

            const result = await updateFrontmatter(this.app, file, updates);
            
            if (!result.success) {
                throw result.error || new Error("Failed to update frontmatter");
            }

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
                    
                    if (file.extension === 'md') {
                        // Update the frontmatter in the file for .md files
                        await this.writeNoteIdToFrontmatter(file, uniqueNewId);
                    }
                    
                    // We also need to update the path in the manifest (which is now under new ID)
                    await this.manifestManager.updateNotePath(uniqueNewId, file.path);

                    // CRITICAL: Update Edit History to match new ID and Path
                    await this.editHistoryManager.renameNote(noteIdToUpdate, uniqueNewId, file.path);
                    
                    return; // Done
                }

                // If ID didn't change, just update the path mapping
                await this.manifestManager.updateNotePath(noteIdToUpdate, file.path);

                // CRITICAL: Update Edit History path
                await this.editHistoryManager.updateNotePath(noteIdToUpdate, file.path);
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

            // Generate expected ID based on current file path and preserved components
            const expectedId = generateNoteId(settings, file, timestamp, currentUuid);

            // If the ID is different, we should update it to match the current path
            if (currentId !== expectedId) {
                console.log(`VC: Note ID mismatch detected for "${file.path}". Updating ID from "${currentId}" to "${expectedId}".`);
                const uniqueNewId = await this.manifestManager.ensureUniqueNoteId(expectedId);
                
                await this.manifestManager.renameNoteEntry(currentId, uniqueNewId);
                
                if (file.extension === 'md') {
                    await this.writeNoteIdToFrontmatter(file, uniqueNewId);
                }
                
                await this.manifestManager.updateNotePath(uniqueNewId, file.path);

                // CRITICAL: Update Edit History to match new ID and Path
                await this.editHistoryManager.renameNote(currentId, uniqueNewId, file.path);
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

    // --- Internal Write Exclusion Methods ---

    /**
     * Registers a file path as having a pending internal write.
     * Events triggered for this path within the timeout window will be ignored.
     */
    public registerInternalWrite(path: string): void {
        this.internalWriteIgnoreSet.add(path);
        // Auto-expire to prevent permanent blocking if event doesn't fire
        setTimeout(() => {
            this.internalWriteIgnoreSet.delete(path);
        }, 1500);
    }

    public isInternalWrite(path: string): boolean {
        return this.internalWriteIgnoreSet.has(path);
    }
}
