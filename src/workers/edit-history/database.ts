import { Dexie, type Table } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';
import type { StoredEdit, StoredManifest } from '@/workers/edit-history/types';
import { sleep } from '@/workers/edit-history/utils';
import { CapacityError } from '@/workers/edit-history/errors';

/**
 * Extended Dexie class with built-in resilience patterns.
 * Handles auto-reconnection, error classification, and operation retries.
 */
class EditHistoryDB extends Dexie {
    edits!: Table<StoredEdit, number>;
    manifests!: Table<StoredManifest, string>;

    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_BASE = 50;
    private readonly MAX_RETRY_DELAY = 1000;

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

        this.version(6).stores({
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

        this.version(7).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, contentHash, [noteId+branchName+createdAt], storageType, chainLength',
            manifests: 'noteId, updatedAt, [updatedAt+noteId]'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                if (edit.storageType === 'full' && edit.chainLength > 0) {
                    edit.chainLength = 0;
                }
            });
        });
    }

    private configureErrorHandling(): void {
        // Handle blocked events (e.g. another tab trying to upgrade)
        this.on('blocked', () => {
            console.warn('VC: Database upgrade blocked - close other tabs or reload');
        });

        // Handle version changes (e.g. another tab upgraded the DB)
        // We must close immediately to allow the upgrade to proceed.
        // The execute() wrapper will handle re-opening when safe.
        this.on('versionchange', (event) => {
            console.info(`VC: Database version changed from ${event.oldVersion} to ${event.newVersion}. Closing connection.`);
            this.close();
        });

        this.on('populate', async () => {
            console.info('VC: Initializing new database');
        });
    }

    /**
     * Executes a database operation with robust error handling, retries, and transaction awareness.
     * This is the primary entry point for all DB interactions.
     */
    async execute<T>(operation: () => Promise<T>, context: string = 'db-op'): Promise<T> {
        // 1. Transaction Passthrough
        // If we are already inside a transaction, we MUST NOT attempt to manage connection state
        // or retry the operation individually, as that would violate transaction isolation
        // or cause TransactionInactiveError. We pass control through to the active transaction.
        if (Dexie.currentTransaction) {
            return operation();
        }

        let attempts = 0;
        let lastError: unknown;

        while (attempts <= this.MAX_RETRIES) {
            try {
                // 2. Ensure connection is open
                if (!this.isOpen()) {
                    await this.open();
                }

                // 3. Execute operation
                return await operation();

            } catch (error: any) {
                lastError = error;
                attempts++;

                // 4. Fatal Error Handling
                // QuotaExceededError is fatal and requires user intervention (cleanup)
                if (error.name === 'QuotaExceededError' || error.message?.toLowerCase().includes('quota')) {
                    throw new CapacityError(
                        'Storage quota exceeded',
                        'database',
                        0, // Unknown current usage
                        0, // Unknown limit
                        'bytes'
                    );
                }

                // Schema/Data errors are logic errors, not transient
                if (error.name === 'SchemaError' || error.name === 'DataError') {
                    throw error;
                }

                // 5. Retry Logic
                const isRecoverable = this.isRecoverableError(error);
                
                if (!isRecoverable || attempts > this.MAX_RETRIES) {
                    if (attempts > this.MAX_RETRIES) {
                        console.error(`VC: DB Operation '${context}' failed after ${attempts} attempts. Last error:`, error);
                    }
                    throw error;
                }

                // 6. Recovery Actions
                if (this.isConnectionError(error)) {
                    // Force close to reset connection state before next attempt
                    try { this.close(); } catch (e) { /* ignore */ }
                }

                // 7. Exponential Backoff with Jitter
                // delay = min(MAX, BASE * 2^attempts) + random_jitter
                const backoff = Math.min(this.MAX_RETRY_DELAY, this.RETRY_DELAY_BASE * Math.pow(2, attempts));
                const jitter = Math.random() * (backoff * 0.5);
                const delay = backoff + jitter;

                console.warn(`VC: Retrying DB op '${context}' (${attempts}/${this.MAX_RETRIES}) in ${Math.round(delay)}ms. Error: ${error.name || error.message}`);
                
                await sleep(delay);
            }
        }

        throw lastError;
    }

    private isRecoverableError(error: any): boolean {
        const name = error.name;
        const message = error.message || '';

        // List of errors that suggest a retry might succeed
        return (
            name === 'DatabaseClosedError' ||
            name === 'TransactionInactiveError' ||
            name === 'UnknownError' || // Often wraps I/O errors or internal browser DB errors
            name === 'AbortError' ||
            name === 'TimeoutError' ||
            name === 'InvalidStateError' || // DB might be closing/opening
            name === 'ReadOnlyError' || // Sometimes transient if lock is held
            message.includes('closing') ||
            message.includes('closed')
        );
    }

    private isConnectionError(error: any): boolean {
        const name = error.name;
        return (
            name === 'DatabaseClosedError' || 
            name === 'UnknownError' || 
            name === 'InvalidStateError'
        );
    }

    async compact(): Promise<void> {
        try {
            await this.execute(async () => {
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
            }, 'compact');
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
        return this.execute(async () => {
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
        }, 'getStats');
    }

    async vacuum(): Promise<void> {
        try {
            await this.execute(async () => {
                await this.transaction('rw', this.edits, this.manifests, async () => {
                    const manifests = await this.manifests.toArray();
                    const validNoteIds = new Set(manifests.map(m => m.noteId));

                    await this.edits.where('noteId').anyOf(Array.from(validNoteIds)).delete();
                });
            }, 'vacuum');
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
        // Don't throw here, let the resilience layer handle it on first access
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
