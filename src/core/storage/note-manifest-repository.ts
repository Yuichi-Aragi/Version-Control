import { injectable, inject } from 'inversify';
import { produce, type Draft } from 'immer';
import * as v from 'valibot';
import type { App } from 'obsidian';
import type { NoteManifest, Branch } from '@/types';
import { NoteManifestSchema } from '@/schemas';
import { PathService } from '@/core';
import { TYPES } from '@/types/inversify.types';
import { QueueService } from '@/services';
import { DEFAULT_BRANCH_NAME } from '@/constants';

type V1NoteManifest = Omit<NoteManifest, 'branches' | 'currentBranch'> & {
    versions: { [versionId: string]: unknown };
    totalVersions: number;
    settings?: unknown;
};

interface CachedManifest {
    data: NoteManifest;
    mtime: number;
}

/**
 * Repository for managing Note Manifests.
 *
 * ARCHITECTURE NOTE:
 * Uses the Public (Queued) / Internal (Unqueued) pattern to prevent deadlocks.
 * Implements "Check-Then-Act" caching strategy using file mtime.
 * Utilises Immer for all state modifications.
 *
 * DEADLOCK PROTECTION:
 * Uses a 'manifest:' prefix for all queue keys to ensure isolation from
 * other services (like VersionContentRepository) operating on the same noteId.
 */
@injectable()
export class NoteManifestRepository {
    private readonly cache = new Map<string, CachedManifest>();
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_MS = 100;
    private readonly QUEUE_PREFIX = 'manifest:';

    constructor(
        @inject(TYPES.App) private readonly app: App,
        @inject(TYPES.PathService) private readonly pathService: PathService,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {}

    private getQueueKey(noteId: string): string {
        return `${this.QUEUE_PREFIX}${noteId}`;
    }

    // ==================================================================================
    // PUBLIC API (Queued)
    // ==================================================================================

    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        return this.queueService.enqueue(this.getQueueKey(noteId), () => this._loadInternal(noteId, forceReload));
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        return this.queueService.enqueue(this.getQueueKey(noteId), async () => {
            const existing = await this._loadInternal(noteId, true);
            if (existing) {
                throw new Error(`Manifest already exists for noteId: ${noteId}`);
            }

            const now = new Date().toISOString();
            const newManifestData = {
                noteId,
                notePath,
                currentBranch: DEFAULT_BRANCH_NAME,
                branches: {
                    [DEFAULT_BRANCH_NAME]: {
                        versions: {},
                        totalVersions: 0,
                    }
                },
                createdAt: now,
                lastModified: now,
            };

            const newManifest = v.parse(NoteManifestSchema, newManifestData);
            await this._writeManifest(noteId, newManifest);
            return newManifest;
        });
    }

    public async update(
        noteId: string,
        updateFn: (draft: Draft<NoteManifest>) => void
    ): Promise<NoteManifest> {
        return this.queueService.enqueue(this.getQueueKey(noteId), async () => {
            const currentManifest = await this._loadInternal(noteId, true);
            if (!currentManifest) {
                throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
            }

            // Use Immer to produce the new state
            const updatedManifest = produce(currentManifest, (draft) => {
                updateFn(draft);
                // Enforce integrity
                const branch = draft.branches[draft.currentBranch];
                if (branch) {
                    branch.totalVersions = Object.keys(branch.versions || {}).length;
                }
            });

            const validatedManifest = v.parse(NoteManifestSchema, updatedManifest);
            await this._writeManifest(noteId, validatedManifest);
            return validatedManifest;
        });
    }

    public invalidateCache(noteId: string): void {
        this.cache.delete(noteId);
    }

    public clearCache(): void {
        this.cache.clear();
    }

    // ==================================================================================
    // INTERNAL IMPLEMENTATION (Unqueued)
    // ==================================================================================

    private async _loadInternal(noteId: string, forceReload: boolean): Promise<NoteManifest | null> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);

        let stat;
        try {
            stat = await this.app.vault.adapter.stat(manifestPath);
        } catch {
            stat = null;
        }

        if (!stat) {
            this.cache.delete(noteId);
            return null;
        }

        if (!forceReload && this.cache.has(noteId)) {
            const cached = this.cache.get(noteId)!;
            if (cached.mtime >= stat.mtime) {
                return cached.data;
            }
        }

        try {
            let manifestToParse = await this._readAndParseManifest(noteId);
            if (!manifestToParse) {
                this.cache.delete(noteId);
                return null;
            }

            // --- Migration Logic ---
            try {
                if (this.isV1Manifest(manifestToParse)) {
                    const migratedManifest = this.migrateV1Manifest(manifestToParse);
                    await this._writeManifest(noteId, migratedManifest);
                    manifestToParse = migratedManifest;
                    return migratedManifest;
                }

                if (this.isLegacyBranchSettings(manifestToParse)) {
                    const migratedManifest = this.migrateLegacyBranchSettings(manifestToParse);
                    await this._writeManifest(noteId, migratedManifest);
                    manifestToParse = migratedManifest;
                }
            } catch (migrationError) {
                console.error(`VC: Migration failed for note ${noteId}. Preserving original structure.`, migrationError);
                // Continue with original manifestToParse if migration fails,
                // allowing partial functionality or later recovery.
            }
            // -----------------------

            const parseResult = v.safeParse(NoteManifestSchema, manifestToParse);
            if (!parseResult.success) {
                console.error(`VC: Manifest for note ${noteId} is invalid.`, parseResult.issues);
                await this.tryBackupCorruptFile(manifestPath);
                this.cache.delete(noteId);
                return null;
            }

            const validatedManifest = parseResult.output;
            this.cache.set(noteId, { data: validatedManifest, mtime: stat.mtime });
            return validatedManifest;

        } catch (error) {
            console.error(`VC: Failed to load manifest for noteId: ${noteId}`, error);
            this.cache.delete(noteId);
            throw error;
        }
    }

    private async _readAndParseManifest(noteId: string): Promise<unknown | null> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);

        return this.executeWithRetry(async () => {
            if (!(await this.app.vault.adapter.exists(manifestPath))) {
                return null;
            }
            const content = await this.app.vault.adapter.read(manifestPath);
            if (!content || content.trim() === '') return null;
            return JSON.parse(content);
        });
    }

    private async _writeManifest(noteId: string, data: NoteManifest): Promise<void> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        const content = JSON.stringify(data, null, 2);

        try {
            await this.executeWithRetry(async () => {
                await this.app.vault.adapter.write(manifestPath, content);
            });

            const stat = await this.app.vault.adapter.stat(manifestPath);
            if (stat) {
                this.cache.set(noteId, { data, mtime: stat.mtime });
            } else {
                this.cache.set(noteId, { data, mtime: Date.now() });
            }
        } catch (error) {
            this.cache.delete(noteId);
            throw error;
        }
    }

    private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * Math.pow(2, attempt)));
                }
            }
        }
        throw lastError;
    }

    private async tryBackupCorruptFile(path: string): Promise<void> {
        const backupPath = `${path}.corrupt.${Date.now()}`;
        try {
            if (await this.app.vault.adapter.exists(path)) {
                await this.app.vault.adapter.copy(path, backupPath);
            }
        } catch { /* ignore */ }
    }

    private isV1Manifest(obj: unknown): obj is V1NoteManifest {
        return obj !== null && typeof obj === 'object' && 'versions' in obj && !('branches' in obj);
    }

    private migrateV1Manifest(v1Manifest: V1NoteManifest): NoteManifest {
        const mainBranch: Branch = {
            versions: v1Manifest.versions as Branch['versions'],
            totalVersions: v1Manifest.totalVersions,
            settings: v1Manifest.settings as Branch['settings'],
        };

        return {
            noteId: v1Manifest.noteId,
            notePath: v1Manifest.notePath,
            createdAt: v1Manifest.createdAt,
            lastModified: v1Manifest.lastModified,
            currentBranch: DEFAULT_BRANCH_NAME,
            branches: {
                [DEFAULT_BRANCH_NAME]: mainBranch,
            },
        };
    }

    private isLegacyBranchSettings(manifest: unknown): boolean {
        if (!manifest || typeof manifest !== 'object' || !('branches' in manifest)) return false;
        const manifestObj = manifest as { branches: Record<string, { settings?: Record<string, unknown> }> };
        // Check if any branch has settings with deprecated keys
        for (const branch of Object.values(manifestObj.branches)) {
            if (branch.settings) {
                if ('noteIdFormat' in branch.settings || 'versionIdFormat' in branch.settings || 'defaultExportFormat' in branch.settings) {
                    return true;
                }
            }
        }
        return false;
    }

    private migrateLegacyBranchSettings(manifest: unknown): NoteManifest {
        // Deep clone to ensure we don't mutate the input in place before we are ready
        const newManifest = JSON.parse(JSON.stringify(manifest)) as NoteManifest & { branches: Record<string, { settings?: Record<string, unknown> }> };

        if (newManifest.branches) {
            for (const branchName in newManifest.branches) {
                const branch = newManifest.branches[branchName];
                if (branch && branch.settings) {
                    // Remove keys that are no longer supported in per-branch settings
                    delete branch.settings['noteIdFormat'];
                    delete branch.settings['versionIdFormat'];
                    delete branch.settings['defaultExportFormat'];
                }
            }
        }
        return newManifest;
    }
}
