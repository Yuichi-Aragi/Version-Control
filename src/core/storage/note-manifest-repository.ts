import { injectable, inject } from 'inversify';
import { produce, type Draft } from 'immer';
import type { App } from 'obsidian';
import type { NoteManifest } from '../../types';
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
        @inject(TYPES.App) private app: App,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.QueueService) private queueService: QueueService
    ) {}

    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        if (!forceReload && this.cache.has(noteId)) {
            return this.cache.get(noteId) ?? null;
        }
        const loaded = await this.readManifest(noteId);
        if (loaded) {
            this.cache.set(noteId, loaded);
        }
        return loaded;
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        // This operation is queued to prevent race conditions with a subsequent update.
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
            await this.writeManifest(noteId, newManifest);
            this.cache.set(noteId, newManifest);
            return newManifest;
        });
    }

    public async update(
        noteId: string,
        updateFn: (draft: Draft<NoteManifest>) => void,
        options: { bypassQueue?: boolean } = {}
    ): Promise<NoteManifest> {
        const task = async () => {
            // 1. Read the most current state directly from disk.
            const currentManifest = await this.readManifest(noteId);
            if (!currentManifest) {
                throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
            }

            // 2. Apply the synchronous transformation function.
            const updatedManifest = produce(currentManifest, updateFn);

            // 3. Write the new state back to disk.
            await this.writeManifest(noteId, updatedManifest);

            // 4. Update the in-memory cache only after the write is successful.
            this.cache.set(noteId, updatedManifest);
            return updatedManifest;
        };
        
        if (options.bypassQueue) {
            return task();
        }
        return this.queueService.enqueue(noteId, task);
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

    private async readManifest(noteId: string): Promise<NoteManifest | null> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        try {
            if (!await this.app.vault.adapter.exists(manifestPath)) {
                return null;
            }
            const content = await this.app.vault.adapter.read(manifestPath);
            if (!content || content.trim() === '') {
                console.warn(`VC: Manifest file ${manifestPath} is empty. Returning null.`);
                return null;
            }
            return JSON.parse(content) as NoteManifest;
        } catch (error) {
            console.error(`VC: Failed to load/parse manifest ${manifestPath}.`, error);
            if (error instanceof SyntaxError) {
                console.error(`VC: Manifest ${manifestPath} is corrupt! A backup of the corrupt file has been created.`);
                await this.tryBackupCorruptFile(manifestPath);
            }
            return null;
        }
    }

    private async writeManifest(noteId: string, data: NoteManifest): Promise<void> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        try {
            const content = JSON.stringify(data, null, 2);
            await this.app.vault.adapter.write(manifestPath, content);
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to save manifest to ${manifestPath}.`, error);
            throw error;
        }
    }

    private async tryBackupCorruptFile(path: string): Promise<void> {
        try {
            await this.app.vault.adapter.copy(path, `${path}.corrupt.${Date.now()}`);
        } catch (backupError) {
            console.error(`VC: Failed to backup corrupt manifest ${path}`, backupError);
        }
    }
}
