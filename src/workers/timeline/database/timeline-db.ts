/// <reference lib="webworker" />

import { Dexie, type Table } from 'dexie';
import { compressSync, strToU8 } from 'fflate';
import { DB_NAME, COMPRESSION_LEVEL } from '@/workers/timeline/config';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { validateStoredEventStructure } from '@/workers/timeline/utils/validation';

/**
 * Timeline Database using Dexie.js
 *
 * This class manages the IndexedDB database for timeline event storage
 * with compression support and proper indexing.
 *
 * SCHEMA VERSIONS:
 * - v4: Initial schema with compound indices
 * - v5: Added compression support, migrated existing data
 */
export class InternalTimelineDB extends Dexie {
    public timeline!: Table<StoredTimelineEvent, number>;

    constructor() {
        super(DB_NAME);

        // Version 4: Initial schema
        this.version(4).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        });

        // Version 5: Add compression support
        this.version(5).stores({
            timeline: '++id, [noteId+branchName+source], &[noteId+branchName+source+toVersionId], toVersionId, timestamp'
        }).upgrade(tx => {
            return tx.table('timeline').toCollection().modify(event => {
                // Migrate uncompressed array data to compressed ArrayBuffer
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
                        // Fallback to empty diff to prevent DB corruption
                        const empty = compressSync(strToU8("[]"));
                        event.diffData = empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength) as ArrayBuffer;
                    }
                }
            });
        });

        // Performance optimization hooks
        this.on('populate', () => {
            this.timeline.hook('creating', (_primKey, obj) => {
                // Validate during creation
                validateStoredEventStructure(obj);
            });
        });
    }
}

// --- Singleton Instance ---

/**
 * Singleton database instance with lazy initialization.
 */
let dbInstance: InternalTimelineDB | null = null;

/**
 * Gets the singleton database instance.
 * Creates the instance on first call.
 *
 * @returns The timeline database instance
 */
export function getDb(): InternalTimelineDB {
    if (!dbInstance) {
        dbInstance = new InternalTimelineDB();
    }
    return dbInstance;
}
