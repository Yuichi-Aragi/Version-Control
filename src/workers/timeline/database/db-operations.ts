/// <reference lib="webworker" />

import { Dexie } from 'dexie';
import { BATCH_DELETE_LIMIT } from '@/workers/timeline/config';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { getDb } from '@/workers/timeline/database/timeline-db';
import { validateStoredEventStructure } from '@/workers/timeline/utils/validation';

/**
 * Database CRUD Operations
 *
 * This module provides database operations for timeline events,
 * including queries, inserts, updates, and deletions.
 */

/**
 * Retrieves all timeline events for a specific note, branch, and source.
 *
 * @param noteId - The note identifier
 * @param branchName - The branch name
 * @param source - The source type ('version' or 'edit')
 * @returns Array of stored timeline events, sorted by timestamp
 */
export async function getTimelineEvents(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit'
): Promise<StoredTimelineEvent[]> {
    const db = getDb();

    try {
        const storedEvents = await db.timeline
            .where('[noteId+branchName+source]')
            .equals([noteId, branchName, source])
            .sortBy('timestamp');

        return storedEvents;
    } catch (error) {
        console.error("VC Worker: getTimelineEvents failed", error);
        // Return empty array on failure for graceful degradation
        return [];
    }
}

/**
 * Stores or updates a timeline event in the database.
 *
 * @param event - The timeline event to store
 * @returns The stored event with its database ID
 */
export async function putTimelineEvent(
    event: StoredTimelineEvent
): Promise<StoredTimelineEvent> {
    const db = getDb();

    try {
        // Validate before storage
        validateStoredEventStructure(event);

        // Store the event
        await db.timeline.put(event);

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

/**
 * Finds an existing event by its unique compound key.
 *
 * @param noteId - The note identifier
 * @param branchName - The branch name
 * @param source - The source type
 * @param toVersionId - The version identifier
 * @returns The existing event or undefined if not found
 */
export async function findExistingEvent(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit',
    toVersionId: string
): Promise<StoredTimelineEvent | undefined> {
    const db = getDb();

    try {
        const existing = await db.timeline
            .where('[noteId+branchName+source+toVersionId]')
            .equals([noteId, branchName, source, toVersionId])
            .first();

        return existing;
    } catch (error) {
        console.error("VC Worker: findExistingEvent failed", error);
        return undefined;
    }
}

/**
 * Updates metadata for timeline events matching the criteria.
 *
 * @param noteId - The note identifier
 * @param versionId - The version identifier
 * @param data - The metadata to update
 * @returns The number of events updated
 */
export async function updateEventMetadata(
    noteId: string,
    versionId: string,
    data: { name?: string; description?: string }
): Promise<number> {
    const db = getDb();

    try {
        const count = await db.timeline
            .where({ noteId, toVersionId: versionId })
            .modify(event => {
                // Handle Name
                if (data.name !== undefined) {
                    if (data.name.trim() === '') {
                        delete event.toVersionName;
                    } else {
                        event.toVersionName = data.name;
                    }
                }

                // Handle Description
                if (data.description !== undefined) {
                    if (data.description.trim() === '') {
                        delete event.toVersionDescription;
                    } else {
                        event.toVersionDescription = data.description;
                    }
                }
            });

        return count;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Metadata update failed',
            'DB_UPDATE_FAILED',
            { originalError: message }
        );
    }
}

/**
 * Deletes a timeline event by its unique compound key.
 *
 * @param noteId - The note identifier
 * @param branchName - The branch name
 * @param source - The source type
 * @param versionId - The version identifier
 * @returns The number of events deleted
 */
export async function deleteEventByVersion(
    noteId: string,
    branchName: string,
    source: 'version' | 'edit',
    versionId: string
): Promise<number> {
    const db = getDb();

    try {
        const count = await db.timeline
            .where('[noteId+branchName+source+toVersionId]')
            .equals([noteId, branchName, source, versionId])
            .delete();

        return count;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Event deletion failed',
            'DB_DELETE_FAILED',
            { originalError: message }
        );
    }
}

/**
 * Clears timeline events for a specific note and optionally a specific source.
 * Uses batch deletion to prevent transaction overflow.
 *
 * @param noteId - The note identifier
 * @param source - Optional source type filter
 * @returns Total number of events deleted
 */
export async function clearTimelineForNote(
    noteId: string,
    source?: 'version' | 'edit'
): Promise<number> {
    const db = getDb();

    try {
        let totalDeleted = 0;

        await db.transaction('rw', db.timeline, async () => {
            if (source) {
                // Batch delete with limit to prevent transaction overflow
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
                // Clear all events for note
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Timeline clear failed',
            'DB_CLEAR_FAILED',
            { originalError: message }
        );
    }
}

/**
 * Clears all timeline events from the database.
 * Uses batch deletion to prevent memory issues.
 *
 * @returns Total number of events deleted
 */
export async function clearAllTimeline(): Promise<number> {
    const db = getDb();

    try {
        let totalDeleted = 0;
        let batchDeleted: number;

        do {
            batchDeleted = await db.timeline
                .limit(BATCH_DELETE_LIMIT)
                .delete();

            totalDeleted += batchDeleted;
        } while (batchDeleted === BATCH_DELETE_LIMIT);

        return totalDeleted;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Global clear failed',
            'DB_GLOBAL_CLEAR_FAILED',
            { originalError: message }
        );
    }
}
