/// <reference lib="webworker" />

import { Dexie, type Table } from 'dexie';
import { DB_NAME } from '@/workers/timeline/config';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { validateStoredEventStructure } from '@/workers/timeline/utils/validation';

/**
 * Robust Timeline Database with auto-reconnection and retry logic.
 */
export class InternalTimelineDB extends Dexie {
    public timeline!: Table<StoredTimelineEvent, number>;
    
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_BASE = 50;
    private readonly MAX_RETRY_DELAY = 1000;

    constructor() {
        super(DB_NAME);

        this.version(4).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        });

        this.version(5).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        });

        // Version 6: Migration to non-compressed storage (Change[])
        // Wipes existing data as per requirement
        this.version(6).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        }).upgrade(tx => {
            console.log("VC Timeline: Upgrading to v6 - Clearing legacy compressed data");
            return tx.table('timeline').clear();
        });

        this.on('populate', () => {
            this.timeline.hook('creating', (_primKey, obj) => {
                validateStoredEventStructure(obj);
            });
        });
        
        // Resilience Hooks
        this.on('blocked', () => {
            console.warn('VC Timeline: Database upgrade blocked');
        });

        this.on('versionchange', (event) => {
            console.info(`VC Timeline: Version changed to ${event.newVersion}. Closing.`);
            this.close();
        });
    }

    /**
     * Executes a database operation with robust error handling, retries, and transaction awareness.
     */
    async execute<T>(operation: () => Promise<T>, context: string = 'timeline-op'): Promise<T> {
        // 1. Transaction Passthrough
        // If we are already inside a transaction, we MUST NOT attempt to manage connection state
        // or retry the operation individually.
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
                if (error.name === 'QuotaExceededError' || error.message?.toLowerCase().includes('quota')) {
                    throw new WorkerError(
                        'Storage quota exceeded',
                        'CAPACITY_ERROR',
                        { originalError: error.message }
                    );
                }

                if (error.name === 'SchemaError' || error.name === 'DataError') {
                    throw error;
                }

                // 5. Retry Logic
                const isRecoverable = (
                    error.name === 'DatabaseClosedError' ||
                    error.name === 'TransactionInactiveError' ||
                    error.name === 'UnknownError' ||
                    error.name === 'AbortError' ||
                    error.name === 'TimeoutError' ||
                    error.name === 'InvalidStateError' ||
                    (error.message && error.message.includes('closing'))
                );

                if (!isRecoverable || attempts > this.MAX_RETRIES) {
                    throw error;
                }

                // 6. Recovery Actions
                if (error.name === 'DatabaseClosedError' || error.name === 'UnknownError' || error.name === 'InvalidStateError') {
                    try { this.close(); } catch (e) { /* ignore */ }
                }

                // 7. Exponential Backoff with Jitter
                const backoff = Math.min(this.MAX_RETRY_DELAY, this.RETRY_DELAY_BASE * Math.pow(2, attempts));
                const jitter = Math.random() * (backoff * 0.5);
                const delay = backoff + jitter;

                console.warn(`VC Timeline: Retrying ${context} (Attempt ${attempts}) in ${Math.round(delay)}ms`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
}

let dbInstance: InternalTimelineDB | null = null;

export function getDb(): InternalTimelineDB {
    if (!dbInstance) {
        dbInstance = new InternalTimelineDB();
    }
    return dbInstance;
}
