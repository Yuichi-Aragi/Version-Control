import { injectable, inject } from 'inversify';
import type { NoteManifest } from '../../types';
import { AtomicFileIO } from './atomic-file-io';
import { PathService } from './path-service';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';

/**
 * Repository for managing individual note manifest files.
 * Handles all CRUD operations and caching for a single note's version metadata.
 * This class encapsulates its own concurrency control for write operations.
 */
@injectable()
export class NoteManifestRepository {
    private cache = new Map<string, NoteManifest>();

    constructor(
        @inject(TYPES.AtomicFileIO) private atomicFileIO: AtomicFileIO,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.QueueService) private queueService: QueueService
    ) {}

    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        if (!forceReload && this.cache.has(noteId)) {
            return this.cache.get(noteId) ?? null;
        }
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        const loaded = await this.atomicFileIO.readJsonFile<NoteManifest>(
            manifestPath,
            null
        );
        if (loaded) {
            this.cache.set(noteId, loaded);
        }
        return loaded;
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        return this.queueService.enqueue(noteId, async () => {
            const now = new Date().toISOString();
            const newManifest: NoteManifest = {
                noteId,
                notePath,
                versions: {},
                totalVersions: 0,
                createdAt: now,
                lastModified: now,
            };
            const manifestPath = this.pathService.getNoteManifestPath(noteId);
            await this.atomicFileIO.writeJsonFile(manifestPath, newManifest);
            this.cache.set(noteId, newManifest);
            return newManifest;
        });
    }

    public async update(
        noteId: string,
        updateFn: (manifest: NoteManifest) => NoteManifest | Promise<NoteManifest>
    ): Promise<NoteManifest> {
        return this.queueService.enqueue(noteId, async () => {
            const manifest = await this.load(noteId, true);
            if (!manifest) {
                throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
            }
            const updatedManifest = await Promise.resolve(updateFn(manifest));
            const manifestPath = this.pathService.getNoteManifestPath(noteId);
            await this.atomicFileIO.writeJsonFile(manifestPath, updatedManifest);
            this.cache.set(noteId, updatedManifest);
            return updatedManifest;
        });
    }

    public invalidateCache(noteId: string): void {
        this.cache.delete(noteId);
        this.queueService.clear(noteId);
    }

    /**
     * Clears the entire in-memory cache of note manifests.
     * This is typically used during plugin unload.
     */
    public clearCache(): void {
        this.cache.clear();
    }
}
