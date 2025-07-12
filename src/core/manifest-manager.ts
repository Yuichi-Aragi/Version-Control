import { App, Vault } from "obsidian";
import { injectable, inject } from 'inversify';
import { NoteManifest } from "../types";
import { PathService } from "./storage/path-service";
import { CentralManifestRepository } from "./storage/central-manifest-repository";
import { NoteManifestRepository } from "./storage/note-manifest-repository";
import { AtomicFileIO } from "./storage/atomic-file-io";
import { TYPES } from "../types/inversify.types";

/**
 * A high-level facade that coordinates operations across the manifest repositories.
 * It handles complex, multi-step operations that involve both the central and note manifests,
 * such as creating or deleting a note's entire version history.
 */
@injectable()
export class ManifestManager {
    private vault: Vault;

    constructor(
        @inject(TYPES.App) app: App,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.CentralManifestRepo) private centralManifestRepo: CentralManifestRepository,
        @inject(TYPES.NoteManifestRepo) private noteManifestRepo: NoteManifestRepository,
        @inject(TYPES.AtomicFileIO) private atomicFileIO: AtomicFileIO
    ) {
        this.vault = app.vault;
    }

    async initializeDatabase(): Promise<void> {
        try {
            const dbRoot = this.pathService.getDbRoot();
            if (!await this.vault.adapter.exists(dbRoot)) {
                await this.vault.createFolder(dbRoot);
            }
            const dbSubFolder = this.pathService.getDbSubfolder();
            if (!await this.vault.adapter.exists(dbSubFolder)) {
                await this.vault.createFolder(dbSubFolder);
            }

            const centralManifestPath = this.pathService.getCentralManifestPath();
            if (!await this.vault.adapter.exists(centralManifestPath)) {
                // Use the injected AtomicFileIO instance for this one-time setup
                await this.atomicFileIO.writeJsonFile(centralManifestPath, { version: "1.0.0", notes: {} });
            }
            await this.centralManifestRepo.load(true);
        } catch (error) {
            console.error("VC: CRITICAL: Failed to initialize database structure.", error);
            throw new Error("Could not initialize database. Check vault permissions and console.");
        }
    }

    public async createNoteEntry(noteId: string, notePath: string): Promise<NoteManifest> {
        if (!noteId || !notePath) {
            throw new Error("VC: Invalid noteId or notePath for createNoteEntry.");
        }

        const noteDbPath = this.pathService.getNoteDbPath(noteId);
        const versionsPath = this.pathService.getNoteVersionsPath(noteId);

        try {
            // 1. Create filesystem structure
            if (!await this.vault.adapter.exists(noteDbPath)) {
                await this.vault.createFolder(noteDbPath);
            }
            if (!await this.vault.adapter.exists(versionsPath)) {
                await this.vault.createFolder(versionsPath);
            }

            // 2. Create the note's own manifest file
            const newNoteManifest = await this.noteManifestRepo.create(noteId, notePath);

            // 3. Add entry to the central manifest
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
            // 1. Remove from central manifest first. This is the critical atomic operation.
            await this.centralManifestRepo.removeNoteEntry(noteId);

            // 2. If successful, delete the data directory.
            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            if (await this.vault.adapter.exists(noteDbPath)) {
                await this.vault.adapter.rmdir(noteDbPath, true);
            }

            // 3. Invalidate caches.
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
            return manifest;
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

    public updateNoteManifest(noteId: string, updateFn: (manifest: NoteManifest) => NoteManifest | Promise<NoteManifest>) {
        return this.noteManifestRepo.update(noteId, updateFn);
    }

    public invalidateNoteManifestCache(noteId: string) {
        this.noteManifestRepo.invalidateCache(noteId);
    }

    // --- Helper Methods ---

    private async rollbackCreateNoteEntry(noteDbPath: string): Promise<void> {
        if (await this.vault.adapter.exists(noteDbPath)) {
            try {
                await this.vault.adapter.rmdir(noteDbPath, true);
            } catch (rmdirError) {
                console.error(`VC: CRITICAL: Failed to rollback directory ${noteDbPath}. Manual cleanup may be needed.`, rmdirError);
            }
        }
    }
}
