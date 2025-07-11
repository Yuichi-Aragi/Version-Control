import { injectable, inject } from 'inversify';
import { CentralManifest } from "../../types";
import { AtomicFileIO } from "./atomic-file-io";
import { PathService } from "./path-service";
import { WriteQueue } from "./write-queue";
import { TYPES } from '../../types/inversify.types';

/**
 * Repository for managing the central manifest file.
 * Handles all CRUD operations and caching for the list of versioned notes.
 */
@injectable()
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;
    private manifestPath: string;

    constructor(
        @inject(TYPES.AtomicFileIO) private atomicFileIO: AtomicFileIO,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.WriteQueue) private writeQueue: WriteQueue
    ) {
        this.manifestPath = this.pathService.getCentralManifestPath();
    }

    public async load(forceReload = false): Promise<CentralManifest> {
        if (this.cache && !forceReload) {
            return this.cache;
        }
        // FIX: Add globalSettings to the default manifest structure.
        const defaultManifest: CentralManifest = { version: "1.0.0", globalSettings: {}, notes: {} };
        const loaded = await this.atomicFileIO.readJsonFile<CentralManifest>(this.manifestPath, defaultManifest);
        
        this.cache = (loaded && typeof loaded.notes === 'object') ? loaded : defaultManifest;
        // Ensure globalSettings object exists
        if (!this.cache.globalSettings) {
            this.cache.globalSettings = {};
        }
        this.rebuildPathToIdMap();
        return this.cache;
    }

    public invalidateCache(): void {
        this.cache = null;
        this.pathToIdMap = null;
    }

    public async getNoteIdByPath(path: string): Promise<string | null> {
        if (!this.pathToIdMap || !this.cache) {
            await this.load(true);
        }
        return this.pathToIdMap?.get(path) ?? null;
    }

    public async addNoteEntry(noteId: string, notePath: string, noteManifestPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this.update((manifest) => {
            manifest.notes[noteId] = {
                notePath, manifestPath: noteManifestPath, createdAt: now, lastModified: now,
            };
            return manifest;
        });
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this.update((manifest) => {
            if (manifest.notes[noteId]) {
                manifest.notes[noteId].notePath = newPath;
                manifest.notes[noteId].lastModified = now;
            } else {
                console.warn(`VC: Attempted to update path in central manifest for non-existent entry: ${noteId}`);
            }
            return manifest;
        });
    }

    public async removeNoteEntry(noteId: string): Promise<void> {
        await this.update((manifest) => {
            if (manifest.notes[noteId]) {
                delete manifest.notes[noteId];
            } else {
                console.warn(`VC: deleteNoteEntry: Note ID ${noteId} not found in central manifest. It might have been removed in a concurrent operation.`);
            }
            return manifest;
        });
    }

    public async updateGlobalSettings(updateFn: (settings: CentralManifest['globalSettings']) => CentralManifest['globalSettings']): Promise<CentralManifest> {
        return this.update((manifest) => {
            manifest.globalSettings = updateFn(manifest.globalSettings || {});
            return manifest;
        });
    }

    private async update(updateFn: (manifest: CentralManifest) => CentralManifest): Promise<CentralManifest> {
        return this.writeQueue.enqueue('central-manifest', async () => {
            const manifest = await this.load(true); // Load fresh inside the queue
            const newManifest = updateFn(manifest);
            await this.atomicFileIO.writeJsonFile(this.manifestPath, newManifest);
            this.cache = newManifest;
            this.rebuildPathToIdMap();
            return newManifest;
        });
    }

    private rebuildPathToIdMap(): void {
        this.pathToIdMap = new Map<string, string>();
        if (!this.cache || !this.cache.notes) {
            console.warn("VC: Central manifest cache or notes property is null/undefined during rebuildPathToIdMap. Initializing empty map.");
            return;
        }
        for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
            if (noteData && noteData.notePath) {
                this.pathToIdMap.set(noteData.notePath, noteId);
            }
        }
    }
}
