import { injectable, inject } from 'inversify';
import type { Draft } from 'immer';
import type { NoteManifest } from "../types";
import { PathService } from "./storage/path-service";
import { CentralManifestRepository } from "./storage/central-manifest-repository";
import { NoteManifestRepository } from "./storage/note-manifest-repository";
import { TYPES } from "../types/inversify.types";
import type { StorageService } from "./storage/storage-service";
import { generateUniqueId } from '../utils/id';

/**
 * A high-level facade that coordinates operations across the manifest repositories.
 * It handles complex, multi-step operations that involve both the central and note manifests,
 * such as creating or deleting a note's entire version history.
 * This class relies on the underlying repositories to handle concurrency control.
 */
@injectable()
export class ManifestManager {
    constructor(
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.StorageService) private storageService: StorageService,
        @inject(TYPES.CentralManifestRepo) private centralManifestRepo: CentralManifestRepository,
        @inject(TYPES.NoteManifestRepo) private noteManifestRepo: NoteManifestRepository
    ) {
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

    /**
     * Renames a note entry in the database, moving the physical folder and updating manifests.
     * @param oldId The current note ID.
     * @param newId The new note ID.
     */
    public async renameNoteEntry(oldId: string, newId: string): Promise<void> {
        if (oldId === newId) return;

        const oldDbPath = this.pathService.getNoteDbPath(oldId);
        const newDbPath = this.pathService.getNoteDbPath(newId);

        try {
            // 1. Rename the physical folder
            await this.storageService.renameFolder(oldDbPath, newDbPath);

            // 2. Update the note manifest (which is now at the new path)
            // We need to clear the cache for the old ID first, as it's no longer valid
            this.noteManifestRepo.invalidateCache(oldId);
            
            // We load from the new ID (which maps to the new path)
            // The file content still has the old ID inside the JSON, so we must update it.
            await this.noteManifestRepo.update(newId, (manifest) => {
                manifest.noteId = newId;
                manifest.lastModified = new Date().toISOString();
            });

            // 3. Update the central manifest
            const centralManifest = await this.centralManifestRepo.load();
            const noteEntry = centralManifest.notes[oldId];
            
            if (noteEntry) {
                // Add new entry
                await this.centralManifestRepo.addNoteEntry(
                    newId, 
                    noteEntry.notePath, 
                    this.pathService.getNoteManifestPath(newId)
                );
                // Remove old entry
                await this.centralManifestRepo.removeNoteEntry(oldId);
            } else {
                console.warn(`VC: Renaming note entry ${oldId} -> ${newId}, but old entry not found in central manifest.`);
            }

        } catch (error) {
            console.error(`VC: Failed to rename note entry from ${oldId} to ${newId}.`, error);
            throw new Error(`Failed to rename version history folder. Check console for details.`);
        }
    }

    /**
     * Ensures a generated note ID is unique within the central manifest.
     * If collision occurs, appends a counter or UUID segment.
     * @param candidateId The proposed ID.
     * @returns A unique ID string.
     */
    public async ensureUniqueNoteId(candidateId: string): Promise<string> {
        const centralManifest = await this.centralManifestRepo.load();
        let uniqueId = candidateId;
        let counter = 1;

        while (centralManifest.notes[uniqueId]) {
            // Collision detected.
            // If the candidate already has a UUID, this is extremely rare.
            // If it's path-based, we append a counter.
            uniqueId = `${candidateId}_${counter}`;
            counter++;
            
            // Safety break to prevent infinite loops in pathological cases
            if (counter > 100) {
                uniqueId = `${candidateId}_${generateUniqueId()}`;
                break;
            }
        }
        return uniqueId;
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
