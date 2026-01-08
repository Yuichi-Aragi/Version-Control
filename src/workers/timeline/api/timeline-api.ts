/// <reference lib="webworker" />

import type { TimelineWorkerApi, TimelineEvent } from '@/types';
import { WorkerError } from '@/workers/timeline/types';
import { getTimelineEvents, deleteEventByVersion, clearTimelineForNote, clearAllTimeline } from '@/workers/timeline/database';
import { updateEventMetadata as dbUpdateEventMetadata } from '@/workers/timeline/database';
import { validateString, serializeAndTransfer, getLockKey } from '@/workers/timeline/utils';
import { generateAndStoreTimelineEvent } from '@/workers/timeline/services';

/**
 * Timeline Worker API Implementation
 *
 * This module implements the TimelineWorkerApi interface, providing
 * all timeline operations exposed to the main thread.
 */

/**
 * Complete implementation of the Timeline Worker API.
 */
export const timelineApi: TimelineWorkerApi = {
    /**
     * Retrieves timeline events for a specific note, branch, and source.
     *
     * @param noteId - The note identifier
     * @param branchName - The branch name
     * @param source - The source type ('version' or 'edit')
     * @returns Serialized array of timeline events
     */
    async getTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<ArrayBuffer> {
        try {
            validateString(noteId, 'noteId');
            validateString(branchName, 'branchName');
            validateString(source, 'source');

            const storedEvents = await getTimelineEvents(noteId, branchName, source);

            // Events are stored uncompressed now, so direct cast is valid
            // StoredTimelineEvent matches TimelineEvent structure exactly now
            const events = storedEvents as TimelineEvent[];

            return serializeAndTransfer(events);
        } catch (error) {
            console.error("VC Worker: getTimeline failed", error);
            // Return empty array on failure for graceful degradation
            return serializeAndTransfer([]);
        }
    },

    /**
     * Generates and stores a timeline event.
     *
     * @param noteId - The note identifier
     * @param branchName - The branch name
     * @param source - The source type ('version' or 'edit')
     * @param fromVersionId - The source version ID (null for initial)
     * @param toVersionId - The target version ID
     * @param toVersionTimestamp - The timestamp of the target version
     * @param toVersionNumber - The version number
     * @param content1 - The source content
     * @param content2 - The target content
     * @param metadata - Optional metadata (name and description)
     * @returns Serialized timeline event
     */
    async generateAndStoreEvent(
        noteId: string,
        branchName: string,
        source: 'version' | 'edit',
        fromVersionId: string | null,
        toVersionId: string,
        toVersionTimestamp: string,
        toVersionNumber: number,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        metadata?: { name?: string; description?: string }
    ): Promise<ArrayBuffer> {
        const event = await generateAndStoreTimelineEvent(
            noteId,
            branchName,
            source,
            fromVersionId,
            toVersionId,
            toVersionTimestamp,
            toVersionNumber,
            content1,
            content2,
            metadata
        );

        return serializeAndTransfer(event);
    },

    /**
     * Updates metadata for timeline events.
     *
     * @param noteId - The note identifier
     * @param versionId - The version identifier
     * @param data - The metadata to update (name and/or description)
     */
    async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        validateString(noteId, 'noteId');
        validateString(versionId, 'versionId');

        // Allow empty strings (meaning "clear field")
        if (data.name !== undefined && typeof data.name !== 'string') {
            throw new WorkerError('name must be a string if provided', 'INVALID_INPUT');
        }

        if (data.description !== undefined && typeof data.description !== 'string') {
            throw new WorkerError('description must be a string if provided', 'INVALID_INPUT');
        }

        await dbUpdateEventMetadata(noteId, versionId, data);
    },

    /**
     * Removes a timeline event by version.
     *
     * @param noteId - The note identifier
     * @param branchName - The branch name
     * @param source - The source type ('version' or 'edit')
     * @param versionId - The version identifier
     */
    async removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void> {
        validateString(noteId, 'noteId');
        validateString(branchName, 'branchName');
        validateString(source, 'source');
        validateString(versionId, 'versionId');

        const lockKey = getLockKey(noteId, branchName, source, versionId);

        await navigator.locks.request(lockKey, { ifAvailable: false }, async () => {
            await deleteEventByVersion(noteId, branchName, source, versionId);
        });
    },

    /**
     * Clears timeline events for a specific note.
     *
     * @param noteId - The note identifier
     * @param source - Optional source type filter
     */
    async clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void> {
        validateString(noteId, 'noteId');
        if (source !== undefined) {
            validateString(source, 'source');
        }

        await clearTimelineForNote(noteId, source);
    },

    /**
     * Clears all timeline events from the database.
     */
    async clearAll(): Promise<void> {
        await clearAllTimeline();
    }
};
