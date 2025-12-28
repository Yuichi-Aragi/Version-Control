import { produce } from 'immer';
import * as v from 'valibot';
import type { CentralManifest, NoteEntry } from '@/types';
import { CentralManifestSchema } from '@/schemas';
import { QueueService } from '@/services';
import type VersionControlPlugin from '@/main';

const CENTRAL_MANIFEST_QUEUE_KEY = 'system:central-manifest';

/**
 * Repository for managing the Central Manifest.
 *
 * ARCHITECTURE NOTE:
 * Uses the Public (Queued) / Internal (Unqueued) pattern to prevent deadlocks.
 * Implements strict state synchronization with the plugin settings.
 * Utilises Immer for all state modifications to ensure immutability.
 */
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;
    private initializationPromise: Promise<void> | null = null;

    constructor(
        private readonly plugin: VersionControlPlugin,
        private readonly queueService: QueueService
    ) {}

    // ==================================================================================
    // PUBLIC API (Queued)
    // ==================================================================================

    public async load(forceReload: boolean = false): Promise<CentralManifest> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, () => this._loadInternal(forceReload));
    }

    public async getNoteIdByPath(path: string): Promise<string | null> {
        if (!path || typeof path !== 'string') return null;
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
             if (!this.pathToIdMap) await this._loadInternal(true);
             return this.pathToIdMap?.get(path) ?? null;
        });
    }

    public async addNoteEntry(noteId: string, notePath: string, noteManifestPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this._updateAndSaveManifest(draft => {
            if (draft.notes[noteId]) {
                console.warn(`VC: Note ID ${noteId} already exists. Overwriting entry.`);
            }
            draft.notes[noteId] = {
                notePath,
                manifestPath: noteManifestPath,
                createdAt: now,
                lastModified: now
            };
        });
    }

    public async removeNoteEntry(noteId: string): Promise<void> {
        await this._updateAndSaveManifest(draft => {
            if (!draft.notes[noteId]) {
                return;
            }
            delete draft.notes[noteId];
        });
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        const now = new Date().toISOString();
        await this._updateAndSaveManifest(draft => {
            const noteEntry = draft.notes[noteId];
            if (noteEntry) {
                noteEntry.notePath = newPath;
                noteEntry.lastModified = now;
            }
        });
    }

    public invalidateCache(): void {
        this.cache = null;
        this.pathToIdMap = null;
    }

    public async getAllNotes(): Promise<Record<string, NoteEntry>> {
        const manifest = await this.load();
        return { ...manifest.notes };
    }

    // ==================================================================================
    // INTERNAL IMPLEMENTATION (Unqueued / Helper)
    // ==================================================================================

    private async _loadInternal(forceReload: boolean): Promise<CentralManifest> {
        // IDEMPOTENCY CHECK:
        // Even if cache exists, we verify it against the current plugin settings state
        // to ensure we never serve stale data if settings were updated externally.
        if (this.cache && !forceReload) {
            // Quick reference check - if settings object hasn't changed, cache is valid
            if (this.plugin.settings.centralManifest === this.cache) {
                return { ...this.cache };
            }
        }

        if (this.initializationPromise) {
            await this.initializationPromise;
            if (this.cache && !forceReload) {
                 if (this.plugin.settings.centralManifest === this.cache) {
                    return { ...this.cache };
                }
            }
        }

        await this._initializeManifestInternal();

        if (!this.cache) {
            throw new Error('Failed to initialize central manifest');
        }

        return { ...this.cache };
    }

    private async _initializeManifestInternal(): Promise<void> {
        try {
            const originalManifest = this.plugin.settings.centralManifest;
            const parseResult = v.safeParse(CentralManifestSchema, originalManifest);

            if (parseResult.success) {
                this.cache = parseResult.output;
                // If the parsed output differs from input (normalization), update settings
                if (JSON.stringify(originalManifest) !== JSON.stringify(parseResult.output)) {
                    this.plugin.settings = produce(this.plugin.settings, draft => {
                        draft.centralManifest = parseResult.output;
                    });
                    await this.plugin.saveSettings();
                }
            } else {
                console.warn("Version Control: Central manifest validation failed. Resetting.", parseResult.issues);
                this.cache = v.parse(CentralManifestSchema, { version: '1.0.0', notes: {} });
                
                this.plugin.settings = produce(this.plugin.settings, draft => {
                    draft.centralManifest = this.cache!;
                });
                await this.plugin.saveSettings();
            }

            this.rebuildPathToIdMap();
        } catch (error) {
            console.error('CentralManifestRepository.initializeManifest failed:', error);
            // Fallback to empty
            this.cache = v.parse(CentralManifestSchema, { version: '1.0.0', notes: {} });
            this.rebuildPathToIdMap();
        }
    }

    /**
     * Helper to update manifest.
     * Uses Immer's produce to ensure immutable state updates.
     */
    private async _updateAndSaveManifest(updateFn: (draft: CentralManifest) => void): Promise<void> {
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            try {
                // Always get fresh state
                const currentManifest = await this._loadInternal(true);

                // 1. Create new manifest state using Immer
                const newManifest = produce(currentManifest, (draft) => {
                    updateFn(draft);
                });

                // 2. Validate
                const validatedManifest = v.parse(CentralManifestSchema, newManifest);

                // 3. Update plugin settings using Immer
                this.plugin.settings = produce(this.plugin.settings, draft => {
                    draft.centralManifest = validatedManifest;
                });
                
                // 4. Persist to disk
                await this.plugin.saveSettings();

                // 5. Update cache
                this.cache = validatedManifest;
                this.rebuildPathToIdMap();
            } catch (error) {
                console.error('updateAndSaveManifest failed:', error);
                this.invalidateCache();
                throw error;
            }
        });
    }

    private rebuildPathToIdMap(): void {
        this.pathToIdMap = new Map<string, string>();
        if (!this.cache?.notes) return;

        for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
            this.pathToIdMap.set(noteData.notePath, noteId);
        }
    }
}
