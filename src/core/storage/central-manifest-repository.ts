import { injectable, inject } from 'inversify';
import { produce } from 'immer';
import type { CentralManifest, NoteEntry } from '../../types';
import { CentralManifestSchema } from '../../schemas';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import type VersionControlPlugin from '../../main';

const CENTRAL_MANIFEST_QUEUE_KEY = 'system:central-manifest';

@injectable()
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;
    private initializationPromise: Promise<void> | null = null;

    constructor(
        @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {
        if (!plugin) throw new Error('CentralManifestRepository: Plugin dependency is required');
        if (!queueService) throw new Error('CentralManifestRepository: QueueService dependency is required');
    }

    public async load(forceReload: boolean = false): Promise<CentralManifest> {
        if (this.cache && !forceReload) {
            return { ...this.cache };
        }

        if (this.initializationPromise) {
            await this.initializationPromise;
            if (this.cache && !forceReload) {
                return { ...this.cache };
            }
        }

        this.initializationPromise = this.initializeManifest();
        await this.initializationPromise;
        this.initializationPromise = null;

        if (!this.cache) {
            throw new Error('Failed to initialize central manifest');
        }

        return { ...this.cache };
    }

    private async initializeManifest(): Promise<void> {
        try {
            const originalManifest = this.plugin.settings.centralManifest;
            const parseResult = CentralManifestSchema.safeParse(originalManifest);

            if (parseResult.success) {
                this.cache = parseResult.data;
                // If Zod applied defaults, the data might have changed.
                if (JSON.stringify(originalManifest) !== JSON.stringify(parseResult.data)) {
                    this.plugin.settings.centralManifest = parseResult.data;
                    await this.plugin.saveSettings();
                }
            } else {
                console.warn("Version Control: Central manifest validation failed. Resetting to default.", parseResult.error);
                this.cache = CentralManifestSchema.parse({}); // Get default value
                this.plugin.settings.centralManifest = this.cache;
                await this.plugin.saveSettings();
            }
            
            this.rebuildPathToIdMap();
        } catch (error) {
            console.error('CentralManifestRepository.initializeManifest failed:', error);
            this.cache = CentralManifestSchema.parse({});
            this.rebuildPathToIdMap();
        }
    }

    public invalidateCache(): void {
        this.cache = null;
        this.pathToIdMap = null;
    }

    public async getNoteIdByPath(path: string): Promise<string | null> {
        if (!path || typeof path !== 'string') return null;
        if (!this.pathToIdMap) await this.load(true);
        return this.pathToIdMap?.get(path) ?? null;
    }

    private async updateAndSaveManifest(updateFn: (draft: CentralManifest) => void): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            try {
                const currentManifest = await this.load();
                const updatedDraft = produce(currentManifest, updateFn);
                
                const newManifest = CentralManifestSchema.parse(updatedDraft);

                this.plugin.settings.centralManifest = newManifest;
                await this.plugin.saveSettings();

                this.cache = newManifest;
                this.rebuildPathToIdMap();
            } catch (error) {
                console.error('updateAndSaveManifest failed:', error);
                this.invalidateCache();
                throw error;
            }
        });
    }

    public async addNoteEntry(noteId: string, notePath: string, noteManifestPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this.updateAndSaveManifest(draft => {
            if (draft.notes[noteId]) {
                console.warn(`VC: Note ID ${noteId} already exists. Overwriting entry.`);
            }
            draft.notes[noteId] = {
                notePath,
                manifestPath: noteManifestPath,
                createdAt: now,
                lastModified: now,
            };
        });
    }

    public async removeNoteEntry(noteId: string): Promise<void> {
        await this.updateAndSaveManifest(draft => {
            if (!draft.notes[noteId]) {
                console.warn(`VC: removeNoteEntry: Note ID ${noteId} not found.`);
                return;
            }
            delete draft.notes[noteId];
        });
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this.updateAndSaveManifest(draft => {
            const noteEntry = draft.notes[noteId];
            if (noteEntry) {
                noteEntry.notePath = newPath;
                noteEntry.lastModified = now;
            } else {
                console.warn(`VC: updateNotePath: Note ID ${noteId} not found.`);
            }
        });
    }

    private rebuildPathToIdMap(): void {
        this.pathToIdMap = new Map<string, string>();
        if (!this.cache?.notes) return;
        
        for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
            if (this.pathToIdMap.has(noteData.notePath)) {
                console.warn(`Duplicate path detected in central manifest: ${noteData.notePath}`);
            }
            this.pathToIdMap.set(noteData.notePath, noteId);
        }
    }

    public async getAllNotes(): Promise<Record<string, NoteEntry>> {
        const manifest = await this.load();
        return { ...manifest.notes };
    }
}
