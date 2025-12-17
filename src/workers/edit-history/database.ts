import { Dexie, type Table } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';
import type { StoredEdit, StoredManifest } from '@/workers/edit-history/types';

class EditHistoryDB extends Dexie {
    edits!: Table<StoredEdit, number>;
    manifests!: Table<StoredManifest, string>;

    private static readonly VERSION = 6;

    constructor() {
        super(CONFIG.DB_NAME);
        this.configureDatabase();
        this.configureErrorHandling();
    }

    private configureDatabase(): void {
        this.version(1).stores({
            edits: '++id, [noteId+editId], noteId',
            manifests: 'noteId'
        });

        this.version(2).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt',
            manifests: 'noteId, updatedAt'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                if (edit.branchName === undefined) edit.branchName = 'main';
                if (edit.createdAt === undefined) edit.createdAt = Date.now();
                if (edit.storageType === undefined) edit.storageType = 'full';
                if (edit.chainLength === undefined) edit.chainLength = 0;
                if (edit.size === undefined) edit.size = edit.content?.byteLength ?? 0;
            });
        });

        this.version(3).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });

        this.version(4).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });

        this.version(5).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, contentHash, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                if (edit.contentHash === undefined) edit.contentHash = '';
                if (edit.uncompressedSize === undefined) edit.uncompressedSize = 0;
            });
        });

        this.version(EditHistoryDB.VERSION).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, contentHash, [noteId+branchName+createdAt], storageType, chainLength',
            manifests: 'noteId, updatedAt, [updatedAt+noteId]'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                edit.storageType = edit.storageType || 'full';
                edit.chainLength = edit.chainLength || 0;
                edit.uncompressedSize = edit.uncompressedSize || 0;
                edit.contentHash = edit.contentHash || '';
            });
        });
    }

    private configureErrorHandling(): void {
        this.on('blocked', () => {
            console.warn('VC: Database upgrade blocked - close other tabs');
        });

        this.on('versionchange', (event) => {
            console.info(`VC: Database version changed from ${event.oldVersion} to ${event.newVersion}`);
            this.close();
        });

        this.on('populate', async () => {
            console.info('VC: Initializing new database');
        });
    }

    async compact(): Promise<void> {
        try {
            await this.transaction('rw', this.edits, this.manifests, async () => {
                const oldCount = await this.edits.count();
                
                await this.edits.toCollection().modify((edit) => {
                    if (edit.content && edit.content.byteLength === 0) {
                        (edit as any).content = undefined;
                    }
                });

                const newCount = await this.edits.count();
                console.info(`VC: Database compacted: ${oldCount} -> ${newCount} records`);
            });
        } catch (error) {
            console.error('VC: Database compaction failed:', error);
        }
    }

    async getStats(): Promise<{
        editCount: number;
        manifestCount: number;
        totalSize: number;
        avgEditSize: number;
    }> {
        const [editCount, manifestCount] = await Promise.all([
            this.edits.count(),
            this.manifests.count()
        ]);

        let totalSize = 0;
        let editSizeCount = 0;

        await this.edits.each((edit) => {
            totalSize += edit.content?.byteLength || 0;
            editSizeCount++;
        });

        return {
            editCount,
            manifestCount,
            totalSize,
            avgEditSize: editSizeCount > 0 ? totalSize / editSizeCount : 0
        };
    }

    async vacuum(): Promise<void> {
        try {
            await this.transaction('rw', this.edits, this.manifests, async () => {
                const manifests = await this.manifests.toArray();
                const validNoteIds = new Set(manifests.map(m => m.noteId));

                await this.edits.where('noteId').anyOf(Array.from(validNoteIds)).delete();
            });
        } catch (error) {
            console.error('VC: Database vacuum failed:', error);
        }
    }
}

export const db = new EditHistoryDB();

export async function initializeDatabase(): Promise<void> {
    try {
        await db.open();
        console.info('VC: Database initialized successfully');
    } catch (error) {
        console.error('VC: Database initialization failed:', error);
        throw error;
    }
}

export async function cleanupDatabase(): Promise<void> {
    try {
        if (db.isOpen()) {
            await db.close();
        }
    } catch (error) {
        console.error('VC: Database cleanup failed:', error);
    }
}
