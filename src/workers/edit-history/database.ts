import { Dexie, type Table } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';
import type { StoredEdit, StoredManifest } from '@/workers/edit-history/types';

class EditHistoryDB extends Dexie {
    edits!: Table<StoredEdit, number>;
    manifests!: Table<StoredManifest, string>;

    constructor() {
        super(CONFIG.DB_NAME);
        this.configureDatabase();
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
                if (!edit.branchName) edit.branchName = 'main';
                if (!edit.createdAt) edit.createdAt = Date.now();
                if (!edit.storageType) edit.storageType = 'full';
                if (edit.chainLength === undefined) edit.chainLength = 0;
                if (!edit.size) edit.size = edit.content?.byteLength ?? 0;
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
    }
}

export const db = new EditHistoryDB();
