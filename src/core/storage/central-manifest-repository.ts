import { injectable, inject } from 'inversify';
import { produce } from 'immer';
import type { App } from 'obsidian';
import type { CentralManifest } from '../../types';
import { PathService } from './path-service';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';

const CENTRAL_MANIFEST_QUEUE_KEY = 'system:central-manifest';

/**
 * Repository for managing the central manifest file.
 * Handles all CRUD operations and caching for the list of versioned notes.
 * This class encapsulates its own concurrency control for write operations.
 */
@injectable()
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;
    private readonly manifestPath: string;
    private readonly defaultManifest: CentralManifest = {
        version: '1.0.0',
        notes: {},
    };

    constructor(
        @inject(TYPES.App) private app: App,
        @inject(TYPES.PathService) private pathService: PathService,
        @inject(TYPES.QueueService) private queueService: QueueService
    ) {
        this.manifestPath = this.pathService.getCentralManifestPath();
    }

    public async load(forceReload = false): Promise<CentralManifest> {
        if (this.cache && !forceReload) {
            return this.cache;
        }

        const loaded = await this.readManifest();

        this.cache = loaded && typeof loaded.notes === 'object' ? loaded : this.defaultManifest;
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

    public async addNoteEntry(
        noteId: string,
        notePath: string,
        noteManifestPath: string
    ): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            const currentManifest = await this.load(true);
            const now = new Date().toISOString();

            const newManifest = produce(currentManifest, draft => {
                draft.notes[noteId] = {
                    notePath,
                    manifestPath: noteManifestPath,
                    createdAt: now,
                    lastModified: now,
                };
            });

            await this.writeManifest(newManifest);
            
            this.cache = newManifest;
            this.rebuildPathToIdMap();
        });
    }

    public async removeNoteEntry(noteId: string): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            const currentManifest = await this.load(true);

            if (!currentManifest.notes[noteId]) {
                console.warn(`VC: removeNoteEntry: Note ID ${noteId} not found. No changes made.`);
                return;
            }

            const newManifest = produce(currentManifest, draft => {
                delete draft.notes[noteId];
            });

            await this.writeManifest(newManifest);
            this.cache = newManifest;
            this.rebuildPathToIdMap();
        });
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            const currentManifest = await this.load(true);
            const now = new Date().toISOString();

            if (!currentManifest.notes[noteId]) {
                console.warn(`VC: updateNotePath: Note ID ${noteId} not found. No changes made.`);
                return;
            }

            const newManifest = produce(currentManifest, draft => {
                const noteEntry = draft.notes[noteId];
                if (noteEntry) {
                    noteEntry.notePath = newPath;
                    noteEntry.lastModified = now;
                }
            });

            await this.writeManifest(newManifest);
            this.cache = newManifest;
            this.rebuildPathToIdMap();
        });
    }

    private rebuildPathToIdMap(): void {
        this.pathToIdMap = new Map<string, string>();
        if (!this.cache || !this.cache.notes) {
            console.warn(
                'VC: Central manifest cache or notes property is null/undefined during rebuildPathToIdMap. Initializing empty map.'
            );
            return;
        }
        for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
            if (noteData && noteData.notePath) {
                this.pathToIdMap.set(noteData.notePath, noteId);
            }
        }
    }

    private async readManifest(): Promise<CentralManifest> {
        try {
            if (!await this.app.vault.adapter.exists(this.manifestPath)) {
                return this.defaultManifest;
            }
            const content = await this.app.vault.adapter.read(this.manifestPath);
            if (!content || content.trim() === '') {
                console.warn(`VC: Manifest file ${this.manifestPath} is empty. Returning default.`);
                return this.defaultManifest;
            }
            return JSON.parse(content) as CentralManifest;
        } catch (error) {
            console.error(`VC: Failed to load/parse manifest ${this.manifestPath}.`, error);
            if (error instanceof SyntaxError) {
                console.error(`VC: Manifest ${this.manifestPath} is corrupt! A backup of the corrupt file has been created.`);
                await this.tryBackupCorruptFile(this.manifestPath);
            }
            return this.defaultManifest;
        }
    }

    private async writeManifest(data: CentralManifest): Promise<void> {
        try {
            const content = JSON.stringify(data, null, 2);
            await this.app.vault.adapter.write(this.manifestPath, content);
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to save manifest to ${this.manifestPath}.`, error);
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
