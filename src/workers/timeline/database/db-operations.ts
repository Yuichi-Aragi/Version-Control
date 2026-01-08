/// <reference lib="webworker" />

import { Dexie } from 'dexie';
import { BATCH_DELETE_LIMIT } from '@/workers/timeline/config';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { getDb } from '@/workers/timeline/database/timeline-db';
import { validateStoredEventStructure } from '@/workers/timeline/utils/validation';

/**
 * Database CRUD Operations with Resilience Wrapper
 */

export async function getTimelineEvents(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit'
): Promise<StoredTimelineEvent[]> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            const events = await db.timeline
                .where('[noteId+branchName+source]')
                .equals([noteId, branchName, source])
                .toArray();
            
            // Perform in-memory sort to ensure deterministic order
            // Primary: Timestamp, Secondary: Version Number
            return events.sort((a, b) => {
                // Compare timestamps
                if (a.timestamp < b.timestamp) return -1;
                if (a.timestamp > b.timestamp) return 1;
                
                // If timestamps are equal, use version number
                return (a.toVersionNumber || 0) - (b.toVersionNumber || 0);
            });
        }, 'getTimelineEvents');
    } catch (error) {
        console.error("VC Worker: getTimelineEvents failed", error);
        return [];
    }
}

export async function putTimelineEvent(
    event: StoredTimelineEvent
): Promise<StoredTimelineEvent> {
    const db = getDb();

    try {
        validateStoredEventStructure(event);

        await db.execute(async () => {
            await db.timeline.put(event);
        }, 'putTimelineEvent');

        return event;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Failed to store timeline event',
            'DB_ERROR',
            { originalError: message }
        );
    }
}

export async function findExistingEvent(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit',
    toVersionId: string
): Promise<StoredTimelineEvent | undefined> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            return await db.timeline
                .where('[noteId+branchName+source+toVersionId]')
                .equals([noteId, branchName, source, toVersionId])
                .first();
        }, 'findExistingEvent');
    } catch (error) {
        console.error("VC Worker: findExistingEvent failed", error);
        return undefined;
    }
}

export async function updateEventMetadata(
    noteId: string,
    versionId: string,
    data: { name?: string; description?: string }
): Promise<number> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            return await db.timeline
                .where({ noteId, toVersionId: versionId })
                .modify(event => {
                    if (data.name !== undefined) {
                        if (data.name.trim() === '') {
                            delete event.toVersionName;
                        } else {
                            event.toVersionName = data.name;
                        }
                    }

                    if (data.description !== undefined) {
                        if (data.description.trim() === '') {
                            delete event.toVersionDescription;
                        } else {
                            event.toVersionDescription = data.description;
                        }
                    }
                });
        }, 'updateEventMetadata');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Metadata update failed',
            'DB_UPDATE_FAILED',
            { originalError: message }
        );
    }
}

export async function deleteEventByVersion(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit',
    versionId: string
): Promise<number> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            return await db.timeline
                .where('[noteId+branchName+source+toVersionId]')
                .equals([noteId, branchName, source, versionId])
                .delete();
        }, 'deleteEventByVersion');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Event deletion failed',
            'DB_DELETE_FAILED',
            { originalError: message }
        );
    }
}

export async function clearTimelineForNote(
    noteId: string,
    source?: 'version' | 'edit'
): Promise<number> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            let totalDeleted = 0;

            await db.transaction('rw', db.timeline, async () => {
                if (source) {
                    let batchDeleted: number;
                    do {
                        batchDeleted = await db.timeline
                            .where('[noteId+branchName+source]')
                            .between([noteId, Dexie.minKey, source], [noteId, Dexie.maxKey, source])
                            .limit(BATCH_DELETE_LIMIT)
                            .delete();
                        totalDeleted += batchDeleted;
                    } while (batchDeleted === BATCH_DELETE_LIMIT);
                } else {
                    let batchDeleted: number;
                    do {
                        batchDeleted = await db.timeline
                            .where('noteId')
                            .equals(noteId)
                            .limit(BATCH_DELETE_LIMIT)
                            .delete();
                        totalDeleted += batchDeleted;
                    } while (batchDeleted === BATCH_DELETE_LIMIT);
                }
            });

            return totalDeleted;
        }, 'clearTimelineForNote');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Timeline clear failed',
            'DB_CLEAR_FAILED',
            { originalError: message }
        );
    }
}

export async function clearAllTimeline(): Promise<number> {
    const db = getDb();

    try {
        return await db.execute(async () => {
            let totalDeleted = 0;
            let batchDeleted: number;

            do {
                batchDeleted = await db.timeline
                    .limit(BATCH_DELETE_LIMIT)
                    .delete();

                totalDeleted += batchDeleted;
            } while (batchDeleted === BATCH_DELETE_LIMIT);

            return totalDeleted;
        }, 'clearAllTimeline');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Global clear failed',
            'DB_GLOBAL_CLEAR_FAILED',
            { originalError: message }
        );
    }
}
