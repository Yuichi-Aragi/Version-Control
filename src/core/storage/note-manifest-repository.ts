import { NoteManifest } from "../../types";
import { AtomicFileIO } from "./atomic-file-io";
import { PathService } from "./path-service";
import { WriteQueue } from "./write-queue";

/**
 * Repository for managing individual note manifest files.
 * Handles all CRUD operations and caching for a single note's version metadata.
 */
export class NoteManifestRepository {
    private cache = new Map<string, NoteManifest>();

    constructor(
        private atomicFileIO: AtomicFileIO,
        private pathService: PathService,
        private writeQueue: WriteQueue
    ) {}

    public async load(noteId: string): Promise<NoteManifest | null> {
        if (this.cache.has(noteId)) {
            return this.cache.get(noteId) ?? null;
        }
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        const loaded = await this.atomicFileIO.readJsonFile<NoteManifest>(manifestPath, null);
        if (loaded) {
            this.cache.set(noteId, loaded);
        }
        return loaded;
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        const now = new Date().toISOString();
        const newManifest: NoteManifest = {
            noteId, notePath, versions: {}, totalVersions: 0, createdAt: now, lastModified: now,
        };
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        await this.atomicFileIO.writeJsonFile(manifestPath, newManifest);
        this.cache.set(noteId, newManifest);
        return newManifest;
    }

    public async update(
        noteId: string,
        updateFn: (manifest: NoteManifest) => NoteManifest | Promise<NoteManifest>
    ): Promise<NoteManifest> {
        return this.writeQueue.enqueue(noteId, async () => {
            const manifest = await this.load(noteId);
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
        this.writeQueue.clear(noteId);
    }
}
