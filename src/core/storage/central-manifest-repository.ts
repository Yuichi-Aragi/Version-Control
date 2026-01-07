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
 * 
 * ENFORCEMENT:
 * Strictly enforces a One-to-One mapping from File Path to Note ID.
 * While a Note ID can conceptually map to multiple paths over time (via renaming),
 * at any single point in time, a File Path (case-sensitive) MUST map to at most one Note ID.
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
            // STRICT ENFORCEMENT: Path Uniqueness
            // Ensure no other ID is already claiming this path
            for (const [existingId, entry] of Object.entries(draft.notes)) {
                if (entry && entry.notePath === notePath && existingId !== noteId) {
                    throw new Error(`Integrity Violation: Path "${notePath}" is already assigned to noteId "${existingId}". Cannot assign to "${noteId}".`);
                }
            }

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
            // STRICT ENFORCEMENT: Path Uniqueness
            // Ensure no other ID is already claiming the new path
            for (const [existingId, entry] of Object.entries(draft.notes)) {
                if (entry && entry.notePath === newPath && existingId !== noteId) {
                    throw new Error(`Integrity Violation: Path "${newPath}" is already assigned to noteId "${existingId}". Cannot move "${noteId}" to this path.`);
                }
            }

            const noteEntry = draft.notes[noteId];
            if (noteEntry) {
                noteEntry.notePath = newPath;
                noteEntry.lastModified = now;
            }
        });
    }

    /**
     * Atomically replaces a note ID with a new one, preserving the entry data.
     * This is critical for renames to ensure we don't violate path uniqueness constraints
     * that would occur if we tried to add the new ID before removing the old one.
     */
    public async replaceNoteId(oldId: string, newId: string, newManifestPath: string): Promise<void> {
        await this._updateAndSaveManifest(draft => {
            const oldEntry = draft.notes[oldId];
            if (!oldEntry) {
                throw new Error(`Cannot replace ID: Old ID "${oldId}" not found.`);
            }
            
            if (newId !== oldId && draft.notes[newId]) {
                throw new Error(`Cannot replace ID: New ID "${newId}" already exists.`);
            }

            // Note: We do not need to check path uniqueness here because we are
            // effectively transferring ownership of the path from oldId to newId
            // within a single atomic transaction.

            draft.notes[newId] = {
                ...oldEntry,
                manifestPath: newManifestPath,
                lastModified: new Date().toISOString()
            };

            if (newId !== oldId) {
                delete draft.notes[oldId];
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
