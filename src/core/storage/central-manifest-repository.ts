import { injectable, inject } from 'inversify';
import { produce } from 'immer';
import type { CentralManifest } from '../../types';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import type VersionControlPlugin from '../../main';

const CENTRAL_MANIFEST_QUEUE_KEY = 'system:central-manifest';

/**
 * Repository for managing the central manifest, which is now stored in the
 * plugin's main settings file (data.json).
 * Handles all update operations and caching for the list of versioned notes.
 * It interacts with the plugin's settings object and triggers saves.
 */
@injectable()
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;

    constructor(
        @inject(TYPES.Plugin) private plugin: VersionControlPlugin,
        @inject(TYPES.QueueService) private queueService: QueueService
    ) {}

    public async load(forceReload = false): Promise<CentralManifest> {
        // The "source of truth" is now the plugin's settings object.
        // `forceReload` means re-populating the cache from the settings object.
        if (this.cache && !forceReload) {
            return this.cache;
        }

        // The data is already loaded by the plugin in `loadSettings`. We just reference it.
        const manifest = this.plugin.settings.centralManifest;
        this.cache = manifest && typeof manifest.notes === 'object' 
            ? manifest 
            : { version: '1.0.0', notes: {} };
        
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

    private async updateAndSaveManifest(updateFn: (draft: CentralManifest) => void): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            // Ensure the latest data is loaded into the cache before modification.
            const currentManifest = await this.load(true);

            const newManifest = produce(currentManifest, updateFn);

            // Update the manifest in the plugin's settings object.
            this.plugin.settings.centralManifest = newManifest;
            
            // Persist the entire settings object to data.json.
            await this.plugin.saveSettings();

            // Update the local cache and map after the save is successful.
            this.cache = newManifest;
            this.rebuildPathToIdMap();
        });
    }

    public async addNoteEntry(
        noteId: string,
        notePath: string,
        noteManifestPath: string
    ): Promise<void> {
        const now = new Date().toISOString();
        await this.updateAndSaveManifest(draft => {
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
                console.warn(`VC: removeNoteEntry: Note ID ${noteId} not found. No changes made.`);
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
                console.warn(`VC: updateNotePath: Note ID ${noteId} not found. No changes made.`);
            }
        });
    }

    private rebuildPathToIdMap(): void {
        this.pathToIdMap = new Map<string, string>();
        if (!this.cache || !this.cache.notes) {
            return;
        }
        for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
            if (noteData && noteData.notePath) {
                this.pathToIdMap.set(noteData.notePath, noteId);
            }
        }
    }
}
