import { produce, type Draft } from 'immer';
import * as v from 'valibot';
import type { App } from 'obsidian';
import type { NoteManifest, Branch } from '@/types';
import { NoteManifestSchema } from '@/schemas';
import { PathService } from '@/core';
import { QueueService } from '@/services';
import { DEFAULT_BRANCH_NAME } from '@/constants';
import { TaskPriority } from '@/types';
import { executeWithRetry } from '@/utils/retry';
import { StorageService } from '@/core/storage/storage-service';

type V1NoteManifest = Omit<NoteManifest, 'branches' | 'currentBranch'> & {
    versions: { [versionId: string]: unknown };
    totalVersions: number;
    settings?: unknown;
};

interface CachedManifest {
    data: NoteManifest;
    mtime: number;
}

export class NoteManifestRepository {
    private readonly cache = new Map<string, CachedManifest>();
    private readonly QUEUE_PREFIX = 'manifest:';

    constructor(
        private readonly app: App,
        private readonly pathService: PathService,
        private readonly queueService: QueueService,
        private readonly storageService: StorageService
    ) {}

    private getQueueKey(noteId: string): string {
        return `${this.QUEUE_PREFIX}${noteId}`;
    }

    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        return this.queueService.add(
            this.getQueueKey(noteId), 
            () => this._loadInternal(noteId, forceReload),
            { priority: TaskPriority.NORMAL }
        );
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        return this.queueService.add(
            this.getQueueKey(noteId), 
            async () => {
                const existing = await this._loadInternal(noteId, true);
                if (existing) throw new Error(`Manifest already exists for noteId: ${noteId}`);

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
                await this._writeManifestInternal(noteId, newManifest);
                return newManifest;
            },
            { priority: TaskPriority.HIGH }
        );
    }

    public async update(
        noteId: string,
        updateFn: (draft: Draft<NoteManifest>) => void
    ): Promise<NoteManifest> {
        return this.queueService.add(
            this.getQueueKey(noteId), 
            async () => {
                const currentManifest = await this._loadInternal(noteId, true);
                if (!currentManifest) {
                    throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
                }

                const updatedManifest = produce(currentManifest, (draft) => {
                    updateFn(draft);
                    const branch = draft.branches[draft.currentBranch];
                    if (branch) {
                        branch.totalVersions = Object.keys(branch.versions || {}).length;
                    }
                });

                const validatedManifest = v.parse(NoteManifestSchema, updatedManifest);
                await this._writeManifestInternal(noteId, validatedManifest);
                return validatedManifest;
            },
            { priority: TaskPriority.HIGH }
        );
    }

    public invalidateCache(noteId: string): void {
        this.cache.delete(noteId);
    }

    public clearCache(): void {
        this.cache.clear();
    }

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
            let manifestToParse = await this._readAndParseManifestInternal(noteId);
            if (!manifestToParse) {
                this.cache.delete(noteId);
                return null;
            }

            try {
                if (this.isV1Manifest(manifestToParse)) {
                    const migratedManifest = this.migrateV1Manifest(manifestToParse);
                    await this._writeManifestInternal(noteId, migratedManifest);
                    manifestToParse = migratedManifest;
                    return migratedManifest;
                }

                if (this.isLegacyBranchSettings(manifestToParse)) {
                    const migratedManifest = this.migrateLegacyBranchSettings(manifestToParse);
                    await this._writeManifestInternal(noteId, migratedManifest);
                    manifestToParse = migratedManifest;
                }
            } catch (migrationError) {
                console.error(`VC: Migration failed for note ${noteId}. Preserving original structure.`, migrationError);
            }

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

    private async _readAndParseManifestInternal(noteId: string): Promise<unknown | null> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);

        return executeWithRetry(async () => {
            if (!(await this.app.vault.adapter.exists(manifestPath))) {
                return null;
            }
            const content = await this.app.vault.adapter.read(manifestPath);
            if (!content || content.trim() === '') return null;
            return JSON.parse(content);
        });
    }

    private async _writeManifestInternal(noteId: string, data: NoteManifest): Promise<void> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        const content = JSON.stringify(data, null, 2);

        try {
            // Robustness: Ensure parent folder exists before writing
            const noteDbPath = this.pathService.getNoteDbPath(noteId);
            await this.storageService.ensureFolderExists(noteDbPath);

            await executeWithRetry(async () => {
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
        const newManifest = JSON.parse(JSON.stringify(manifest)) as NoteManifest & { branches: Record<string, { settings?: Record<string, unknown> }> };
        if (newManifest.branches) {
            for (const branchName in newManifest.branches) {
                const branch = newManifest.branches[branchName];
                if (branch && branch.settings) {
                    delete branch.settings['noteIdFormat'];
                    delete branch.settings['versionIdFormat'];
                    delete branch.settings['defaultExportFormat'];
                }
            }
        }
        return newManifest;
    }
}
