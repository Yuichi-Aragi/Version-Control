/// <reference lib="webworker" />

import { Dexie, type Table } from 'dexie';
import { compressSync, strToU8 } from 'fflate';
import { DB_NAME, COMPRESSION_LEVEL } from '@/workers/timeline/config';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { validateStoredEventStructure } from '@/workers/timeline/utils/validation';

/**
 * Robust Timeline Database with auto-reconnection and retry logic.
 */
export class InternalTimelineDB extends Dexie {
    public timeline!: Table<StoredTimelineEvent, number>;
    
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_BASE = 50;

    constructor() {
        super(DB_NAME);

        this.version(4).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        });

        this.version(5).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        }).upgrade(tx => {
            return tx.table('timeline').toCollection().modify(event => {
                if (Array.isArray(event.diffData)) {
                    try {
                        const json = JSON.stringify(event.diffData);
                        const u8 = strToU8(json);
                        const compressed = compressSync(u8, { level: COMPRESSION_LEVEL });
                        event.diffData = compressed.buffer.slice(
                            compressed.byteOffset,
                            compressed.byteOffset + compressed.byteLength
                        ) as ArrayBuffer;
                    } catch (e) {
                        console.error("VC Worker: Failed to migrate timeline event", event.id, e);
                        const empty = compressSync(strToU8("[]"));
                        event.diffData = empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength) as ArrayBuffer;
                    }
                }
            });
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
     * Executes a database operation with robust error handling and retries.
     */
    async execute<T>(operation: () => Promise<T>, context: string = 'timeline-op'): Promise<T> {
        let attempts = 0;
        let lastError: unknown;

        while (attempts <= this.MAX_RETRIES) {
            try {
                if (!this.isOpen()) {
                    await this.open();
                }
                return await operation();
            } catch (error: any) {
                lastError = error;
                attempts++;

                const isRecoverable = (
                    error.name === 'DatabaseClosedError' ||
                    error.name === 'TransactionInactiveError' ||
                    error.name === 'UnknownError' ||
                    error.name === 'AbortError' ||
                    (error.message && error.message.includes('closing'))
                );

                if (!isRecoverable || attempts > this.MAX_RETRIES) {
                    throw error;
                }

                console.warn(`VC Timeline: Retrying ${context} (Attempt ${attempts})`);
                
                if (error.name === 'DatabaseClosedError' || error.name === 'UnknownError') {
                    this.close();
                }

                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_BASE * Math.pow(2, attempts)));
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
