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
            // --- 1. Ensure DB Root and Subfolders exist ---
            await this.ensureFolderExists(this.pathService.getDbRoot());
            await this.ensureFolderExists(this.pathService.getDbSubfolder());

            // --- 2. Ensure Central Manifest file exists and is a file ---
            const centralManifestPath = this.pathService.getCentralManifestPath();
            const centralManifestFile = this.vault.getAbstractFileByPath(centralManifestPath);
            if (centralManifestFile) {
                if (!(centralManifestFile instanceof TFile)) {
                     throw new Error(`Central manifest path "${centralManifestPath}" exists but is a folder, not a file. Please remove it and restart.`);
                }
            } else {
                // Write the initial manifest directly using the vault adapter.
                const defaultManifestContent = JSON.stringify({ version: "1.0.0", notes: {} }, null, 2);
                await this.vault.adapter.write(centralManifestPath, defaultManifestContent);
            }

            // --- 3. Load the manifest into the repository ---
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

            // 2. If successful, trash the data directory for recoverability.
            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            const folderToDelete = this.vault.getAbstractFileByPath(noteDbPath);
            if (folderToDelete instanceof TFolder) {
                await this.vault.trash(folderToDelete, true);
            }

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
        const folderToRollback = this.vault.getAbstractFileByPath(noteDbPath);
        if (folderToRollback instanceof TFolder) {
            try {
                await this.vault.trash(folderToRollback, true);
            } catch (rmdirError) {
                console.error(`VC: CRITICAL: Failed to rollback (trash) directory ${noteDbPath}. Manual cleanup may be needed.`, rmdirError);
            }
        }
    }
}
