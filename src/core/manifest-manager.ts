import { App, Vault, TFolder, TFile } from "obsidian";
import { injectable, inject } from 'inversify';
import type { Draft } from 'immer';
import type { NoteManifest } from "../types";
import { PathService } from "./storage/path-service";
import { CentralManifestRepository } from "./storage/central-manifest-repository";
import { NoteManifestRepository } from "./storage/note-manifest-repository";
import { TYPES } from "../types/inversify.types";

/**
 * A high-level facade that coordinates operations across the manifest repositories.
 * It handles complex, multi-step operations that involve both the central and note manifests,
 * such as creating or deleting a note's entire version history.
 * This class relies on the underlying repositories to handle concurrency control.
 */
@injectable()
export class ManifestManager {
    private vault: Vault;

    constructor(
        @inject(TYPES.App) app: App,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.CentralManifestRepo) private centralManifestRepo: CentralManifestRepository,
        @inject(TYPES.NoteManifestRepo) private noteManifestRepo: NoteManifestRepository
    ) {
        this.vault = app.vault;
    }

    async initializeDatabase(): Promise<void> {
        try {
            // --- 1. Ensure DB Root exists ---
            // The per-note folders will be created inside this root.
            await this.ensureFolderExists(this.pathService.getDbRoot());

            // --- 2. Central Manifest is now in data.json, no file to check/create ---

            // --- 3. Load the manifest into the repository ---
            // This will now read from the plugin's settings object.
            await this.centralManifestRepo.load(true);
        } catch (error) {
            console.error("VC: CRITICAL: Failed to initialize database structure.", error);
            const message = error instanceof Error ? error.message : "Could not initialize database. Check vault permissions and console.";
            throw new Error(message);
        }
    }

    public async createNoteEntry(noteId: string, notePath: string): Promise<NoteManifest> {
        if (!noteId || !notePath) {
            throw new Error("VC: Invalid noteId or notePath for createNoteEntry.");
        }

        // The path to the note's own folder, e.g., .versiondb/xxxxxxxx
        const noteDbPath = this.pathService.getNoteDbPath(noteId);
        const versionsPath = this.pathService.getNoteVersionsPath(noteId);

        try {
            // 1. Create filesystem structure using the robust helper
            await this.ensureFolderExists(noteDbPath);
            await this.ensureFolderExists(versionsPath);

            // 2. Create the note's own manifest file (this is now a queued operation)
            const newNoteManifest = await this.noteManifestRepo.create(noteId, notePath);

            // 3. Add entry to the central manifest (this is now a queued operation)
            await this.centralManifestRepo.addNoteEntry(noteId, notePath, this.pathService.getNoteManifestPath(noteId));
            
            return newNoteManifest;

        } catch (error) {
            console.error(`VC: Failed to create new note entry for ID ${noteId}. Attempting rollback.`, error);
            await this.rollbackCreateNoteEntry(noteDbPath);
            this.noteManifestRepo.invalidateCache(noteId);
            throw error;
        }
    }

    public async deleteNoteEntry(noteId: string): Promise<void> {
        try {
            // 1. Remove from central manifest first. This is a critical, queued operation.
            await this.centralManifestRepo.removeNoteEntry(noteId);

            // 2. If successful, permanently delete the data directory.
            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            await this.permanentlyDeleteFolder(noteDbPath);

            // 3. Invalidate caches and clear queues.
            this.noteManifestRepo.invalidateCache(noteId);

        } catch (error) {
            console.error(`VC: Failed to complete deletion for note entry ID ${noteId}`, error);
            throw new Error(`Failed to delete version history for a note. The operation may be incomplete.`);
        }
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        // Update both manifests. The repositories handle queuing and atomicity.
        await this.noteManifestRepo.update(noteId, (manifest) => {
            manifest.notePath = newPath;
            manifest.lastModified = new Date().toISOString();
        }).catch(err => {
            console.warn(`VC: Attempted to update path for non-existent note manifest: ${noteId}. Error: ${err.message}`);
        });

        await this.centralManifestRepo.updateNotePath(noteId, newPath);
    }

    // --- Delegated Methods ---

    public loadCentralManifest(forceReload = false) {
        return this.centralManifestRepo.load(forceReload);
    }

    public invalidateCentralManifestCache() {
        this.centralManifestRepo.invalidateCache();
    }

    public getNoteIdByPath(path: string) {
        return this.centralManifestRepo.getNoteIdByPath(path);
    }

    public loadNoteManifest(noteId: string) {
        return this.noteManifestRepo.load(noteId);
    }

    public updateNoteManifest(noteId: string, updateFn: (draft: Draft<NoteManifest>) => void) {
        // FIX: The signature now only accepts a synchronous recipe function, matching the repository.
        return this.noteManifestRepo.update(noteId, updateFn);
    }

    public invalidateNoteManifestCache(noteId: string) {
        this.noteManifestRepo.invalidateCache(noteId);
    }

    // --- Helper Methods ---

    /**
     * Robustly ensures a folder exists. It first checks for a file conflict,
     * then checks for folder existence, and only then attempts to create it.
     * This minimizes errors and handles race conditions gracefully.
     * @param path The full path of the folder to ensure existence of.
     */
    private async ensureFolderExists(path: string): Promise<void> {
        const item = this.vault.getAbstractFileByPath(path);
    
        if (item) {
            if (item instanceof TFolder) {
                // Folder already exists, our job is done.
                return;
            } else {
                // A file exists where we need a folder. This is a critical, unrecoverable state.
                throw new Error(`A file exists at the required folder path "${path}". Please remove it and restart the plugin.`);
            }
        }
    
        try {
            // Attempt to create the folder, as we've established it doesn't exist.
            await this.vault.createFolder(path);
        } catch (error) {
            // This catch block is a fallback for race conditions. If another process
            // creates the folder between our check and our create call, this error is ignored.
            if (error instanceof Error && error.message.includes('Folder already exists')) {
                return;
            }
            // Any other error (e.g., file system permissions) is a real problem.
            console.error(`VC: Critical error while trying to create folder at "${path}".`, error);
            throw error;
        }
    }

    private async rollbackCreateNoteEntry(noteDbPath: string): Promise<void> {
        // This is a rollback for an internal database operation, so we use permanent deletion.
        await this.permanentlyDeleteFolder(noteDbPath);
    }

    /**
     * Permanently and recursively deletes a folder using the vault adapter.
     * This is for internal use on the `.versiondb` directory and bypasses trash settings.
     * @param path The path of the folder to delete.
     */
    private async permanentlyDeleteFolder(path: string): Promise<void> {
        const adapter = this.vault.adapter;
        try {
            if (await adapter.exists(path)) {
                // The `true` flag enables recursive deletion. This is a permanent operation.
                await adapter.rmdir(path, true);
            }
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to permanently delete folder ${path}. Manual cleanup may be needed.`, error);
            // We don't re-throw, to allow the calling operation to continue if possible.
        }
    }
}
