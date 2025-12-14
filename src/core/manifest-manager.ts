import { injectable, inject } from 'inversify';
import type { Draft } from 'immer';
import type { NoteManifest } from "@/types";
import { PathService } from "@/core";
import { CentralManifestRepository } from "@/core";
import { NoteManifestRepository } from "@/core";
import { TYPES } from '@/types/inversify.types';
import type { StorageService } from "@/core";
import { generateUniqueId } from '@/utils/id';

/**
 * A high-level facade that coordinates operations across the manifest repositories.
 * It handles complex, multi-step operations that involve both the central and note manifests.
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
            await this.storageService.ensureFolderExists(this.pathService.getDbRoot());
            await this.centralManifestRepo.load(true);
        } catch (error) {
            console.error("VC: CRITICAL: Failed to initialize database structure.", error);
            const message = error instanceof Error ? error.message : "Could not initialize database. Check vault permissions and console.";
            throw new Error(message);
        }
    }

    /**
     * Checks if any noteId already exists for a specific path in the central manifest.
     * If multiple exist, it consolidates them by keeping the oldest one and removing others.
     * Returns the single valid noteId for the path, or null if none exist.
     */
    public async getConsolidatedNoteIdForPath(path: string): Promise<string | null> {
        const centralManifest = await this.centralManifestRepo.load();
        const matches: { id: string; createdAt: string }[] = [];

        for (const [id, entry] of Object.entries(centralManifest.notes)) {
            if (!entry) continue;
            if (entry.notePath === path) {
                matches.push({ id, createdAt: entry.createdAt });
            }
        }

        if (matches.length === 0) return null;

        if (matches.length === 1) return matches[0]!.id;

        // Multiple matches found. Sort by createdAt ascending (oldest first).
        // If createdAt is invalid or same, fallback to ID string comparison for determinism.
        matches.sort((a, b) => {
            const timeA = new Date(a.createdAt).getTime();
            const timeB = new Date(b.createdAt).getTime();
            if (timeA !== timeB) return timeA - timeB;
            return a.id.localeCompare(b.id);
        });

        const winner = matches[0]!;
        const losers = matches.slice(1);

        console.log(`VC: Consolidated IDs for "${path}". Winner: ${winner.id}. Removing: ${losers.map(l => l.id).join(', ')}`);

        // Remove losers from central manifest
        for (const loser of losers) {
            await this.centralManifestRepo.removeNoteEntry(loser.id);
        }

        return winner.id;
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

            await this.centralManifestRepo.addNoteEntry(
                noteId, 
                notePath, 
                this.pathService.getNoteManifestPath(noteId),
                false // Initialize hasEditHistory as false
            );
            
            return newNoteManifest;

        } catch (error) {
            console.error(`VC: Failed to create new note entry for ID ${noteId}. Attempting rollback.`, error);
            await this.storageService.permanentlyDeleteFolder(noteDbPath);
            this.noteManifestRepo.invalidateCache(noteId);
            throw error;
        }
    }

    /**
     * Recovers a missing physical note manifest if the note exists in the central manifest.
     * This is used during migration or recovery scenarios where the central registry knows about a note
     * (e.g. from legacy edit history) but the file system structure is missing.
     */
    public async recoverMissingNoteManifest(noteId: string, notePath: string): Promise<NoteManifest> {
        const noteDbPath = this.pathService.getNoteDbPath(noteId);
        const versionsPath = this.pathService.getNoteVersionsPath(noteId);

        try {
            // Ensure physical folders exist
            await this.storageService.ensureFolderExists(noteDbPath);
            await this.storageService.ensureFolderExists(versionsPath);

            // Create the physical manifest file.
            // Note: We do NOT call centralManifestRepo.addNoteEntry because it should already be there.
            const newNoteManifest = await this.noteManifestRepo.create(noteId, notePath);
            return newNoteManifest;
        } catch (error) {
            console.error(`VC: Failed to recover note manifest for ID ${noteId}.`, error);
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

    public async setHasEditHistory(noteId: string, hasEditHistory: boolean): Promise<void> {
        await this.centralManifestRepo.updateHasEditHistory(noteId, hasEditHistory);
    }

    public async renameNoteEntry(oldId: string, newId: string): Promise<void> {
        if (oldId === newId) return;

        const oldDbPath = this.pathService.getNoteDbPath(oldId);
        const newDbPath = this.pathService.getNoteDbPath(newId);

        try {
            await this.storageService.renameFolder(oldDbPath, newDbPath);

            this.noteManifestRepo.invalidateCache(oldId);
            
            await this.noteManifestRepo.update(newId, (manifest) => {
                manifest.noteId = newId;
                manifest.lastModified = new Date().toISOString();
            });

            const centralManifest = await this.centralManifestRepo.load();
            const noteEntry = centralManifest.notes[oldId];
            
            if (noteEntry) {
                await this.centralManifestRepo.addNoteEntry(
                    newId, 
                    noteEntry.notePath, 
                    this.pathService.getNoteManifestPath(newId),
                    noteEntry.hasEditHistory
                );
                await this.centralManifestRepo.removeNoteEntry(oldId);
            } else {
                console.warn(`VC: Renaming note entry ${oldId} -> ${newId}, but old entry not found in central manifest.`);
            }

        } catch (error) {
            console.error(`VC: Failed to rename note entry from ${oldId} to ${newId}.`, error);
            throw new Error(`Failed to rename version history folder. Check console for details.`);
        }
    }

    public async ensureUniqueNoteId(candidateId: string): Promise<string> {
        const centralManifest = await this.centralManifestRepo.load();
        let uniqueId = candidateId;
        let counter = 1;

        while (centralManifest.notes[uniqueId]) {
            uniqueId = `${candidateId}_${counter}`;
            counter++;
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
        updateFn: (draft: Draft<NoteManifest>) => void
    ) {
        return this.noteManifestRepo.update(noteId, updateFn);
    }

    public invalidateNoteManifestCache(noteId: string) {
        this.noteManifestRepo.invalidateCache(noteId);
    }
}
