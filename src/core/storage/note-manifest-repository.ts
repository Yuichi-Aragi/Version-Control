import { injectable, inject } from 'inversify';
import { produce, type Draft } from 'immer';
import type { App } from 'obsidian';
import type { NoteManifest, Branch } from '../../types';
import { NoteManifestSchema } from '../../schemas';
import { PathService } from './path-service';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import { DEFAULT_BRANCH_NAME } from '../../constants';

type V1NoteManifest = Omit<NoteManifest, 'branches' | 'currentBranch'> & {
    versions: { [versionId: string]: any };
    totalVersions: number;
    settings?: any;
};

@injectable()
export class NoteManifestRepository {
    private readonly cache = new Map<string, NoteManifest>();

    constructor(
        @inject(TYPES.App) private readonly app: App,
        @inject(TYPES.PathService) private readonly pathService: PathService,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {}

    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId: must be a non-empty string');
        }

        if (!forceReload && this.cache.has(noteId)) {
            return this.cache.get(noteId) ?? null;
        }

        try {
            let manifestToParse = await this.readAndParseManifest(noteId);
            if (!manifestToParse) return null;

            if (this.isV1Manifest(manifestToParse)) {
                const migratedManifest = this.migrateV1Manifest(manifestToParse);
                await this.writeManifest(noteId, migratedManifest);
                manifestToParse = migratedManifest;
            }

            const parseResult = NoteManifestSchema.safeParse(manifestToParse);
            if (!parseResult.success) {
                console.error(`VC: Manifest for note ${noteId} is invalid.`, parseResult.error);
                await this.tryBackupCorruptFile(this.pathService.getNoteManifestPath(noteId));
                return null;
            }
            
            const validatedManifest = parseResult.data;
            this.cache.set(noteId, validatedManifest);
            return validatedManifest;

        } catch (error) {
            console.error(`VC: Failed to load manifest for noteId: ${noteId}`, error);
            throw error;
        }
    }

    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        return this.queueService.enqueue(noteId, async () => {
            const existing = await this.readAndParseManifest(noteId);
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

            const newManifest = NoteManifestSchema.parse(newManifestData);
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
        const task = async (): Promise<NoteManifest> => {
            const currentManifest = await this.load(noteId, true);
            if (!currentManifest) {
                throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
            }

            const updatedDraft = produce(currentManifest, (draft) => {
                updateFn(draft);
                // Enforce integrity after the update
                const branch = draft.branches[draft.currentBranch];
                if (branch) {
                    branch.totalVersions = Object.keys(branch.versions || {}).length;
                }
            });

            const updatedManifest = NoteManifestSchema.parse(updatedDraft);
            await this.writeManifest(noteId, updatedManifest);
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

    public clearCache(): void {
        this.cache.clear();
    }

    private async readAndParseManifest(noteId: string): Promise<unknown | null> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        try {
            if (!(await this.app.vault.adapter.exists(manifestPath))) {
                return null;
            }
            const content = await this.app.vault.adapter.read(manifestPath);
            if (!content || content.trim() === '') return null;
            return JSON.parse(content);
        } catch (error) {
            console.error(`VC: Failed to read or parse manifest ${manifestPath}.`, error);
            return null;
        }
    }

    private async writeManifest(noteId: string, data: NoteManifest): Promise<void> {
        const manifestPath = this.pathService.getNoteManifestPath(noteId);
        const content = JSON.stringify(data, null, 2);
        await this.app.vault.adapter.write(manifestPath, content);
    }

    private async tryBackupCorruptFile(path: string): Promise<void> {
        const backupPath = `${path}.corrupt.${Date.now()}`;
        try {
            if (await this.app.vault.adapter.exists(path)) {
                await this.app.vault.adapter.copy(path, backupPath);
                console.log(`VC: Successfully backed up corrupt manifest to ${backupPath}`);
            }
        } catch (backupError) {
            console.error(`VC: Failed to backup corrupt manifest ${path}`, backupError);
        }
    }

    private isV1Manifest(obj: any): obj is V1NoteManifest {
        return obj && typeof obj === 'object' && 'versions' in obj && !('branches' in obj);
    }
    
    private migrateV1Manifest(v1Manifest: V1NoteManifest): NoteManifest {
        const mainBranch: Branch = {
            versions: v1Manifest.versions,
            totalVersions: v1Manifest.totalVersions,
            settings: v1Manifest.settings,
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
}
