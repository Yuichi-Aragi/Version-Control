import { App, Vault } from "obsidian";
import { injectable, inject } from 'inversify';
import type { Draft } from 'immer';
import type { NoteManifest } from "../types";
import { PathService } from "./storage/path-service";
import { CentralManifestRepository } from "./storage/central-manifest-repository";
import { NoteManifestRepository } from "./storage/note-manifest-repository";
import { TYPES } from "../types/inversify.types";
import type { StorageService } from "./storage/storage-service";

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
        @inject(TYPES.StorageService) private storageService: StorageService,
        @inject(TYPES.CentralManifestRepo) private centralManifestRepo: CentralManifestRepository,
        @inject(TYPES.NoteManifestRepo) private noteManifestRepo: NoteManifestRepository
    ) {
        this.vault = app.vault;
    }

    async initializeDatabase(): Promise<void> {
        try {
            // --- 1. Ensure DB Root exists at the configured path ---
            await this.storageService.ensureFolderExists(this.pathService.getDbRoot());

            // --- 2. Load the central manifest into the repository ---
            // This will read from the plugin's settings object.
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
            await this.storageService.ensureFolderExists(noteDbPath);
            await this.storageService.ensureFolderExists(versionsPath);

            const newNoteManifest = await this.noteManifestRepo.create(noteId, notePath);

            await this.centralManifestRepo.addNoteEntry(noteId, notePath, this.pathService.getNoteManifestPath(noteId));
            
            return newNoteManifest;

        } catch (error) {
            console.error(`VC: Failed to create new note entry for ID ${noteId}. Attempting rollback.`, error);
            await this.storageService.permanentlyDeleteFolder(noteDbPath);
            this.noteManifestRepo.invalidateCache(noteId);
            throw error;
        }
    }



    public async deleteNoteEntry(noteId: string): Promise<void> {
        try {
            await this.centralManifestRepo.removeNoteEntry(noteId);

            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            await this.storageService.permanentlyDeleteFolder(noteDbPath);

            this.noteManifestRepo.invalidateCache(noteId);

        } catch (error) {
            console.error(`VC: Failed to complete deletion for note entry ID ${noteId}`, error);
            throw new Error(`Failed to delete version history for a note. The operation may be incomplete.`);
        }
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
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

    public updateNoteManifest(
        noteId: string, 
        updateFn: (draft: Draft<NoteManifest>) => void,
        options: { bypassQueue?: boolean } = {}
    ) {
        return this.noteManifestRepo.update(noteId, updateFn, options);
    }

    public invalidateNoteManifestCache(noteId: string) {
        this.noteManifestRepo.invalidateCache(noteId);
    }
}
