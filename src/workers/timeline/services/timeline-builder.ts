/// <reference lib="webworker" />

import type { TimelineEvent } from '@/types';
import type { StoredTimelineEvent } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { getDb } from '@/workers/timeline/database';
import { findExistingEvent, putTimelineEvent } from '@/workers/timeline/database';
import {
    validateString,
    validateContent,
    compressDiffData,
    getLockKey,
    validateStoredEventStructure,
} from '@/workers/timeline/utils';
import { isValidNumber, isNonEmptyString } from '@/workers/timeline/utils';
import { processContentDiff } from '@/workers/timeline/services/event-processor';
import { calculateStats } from '@/workers/timeline/services/stats-calculator';

/**
 * Timeline Builder Service
 *
 * This module handles the creation and storage of timeline events.
 */

/**
 * Generates and stores a timeline event.
 * This is the main service function that orchestrates the entire process:
 * 1. Validates input
 * 2. Computes diff
 * 3. Calculates statistics
 * 4. Compresses data
 * 5. Stores in database (with lock)
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
 * @returns The created timeline event
 * @throws {WorkerError} If any step fails
 */
export async function generateAndStoreTimelineEvent(
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
): Promise<TimelineEvent> {
    const db = getDb();

    // 1. Strict Input Validation
    validateString(noteId, 'noteId');
    validateString(branchName, 'branchName');
    validateString(source, 'source');
    validateString(toVersionId, 'toVersionId');
    validateString(toVersionTimestamp, 'toVersionTimestamp');

    if (!isValidNumber(toVersionNumber)) {
        throw new WorkerError('toVersionNumber must be a valid number', 'INVALID_INPUT');
    }

    if (fromVersionId !== null && !isNonEmptyString(fromVersionId)) {
        throw new WorkerError('fromVersionId must be null or non-empty string', 'INVALID_INPUT');
    }

    validateContent(content1);
    validateContent(content2);

    // 2. Data Preparation (CPU Bound - before lock)
    const diffData = processContentDiff(content1, content2);
    const stats = calculateStats(diffData);
    const compressedDiff = compressDiffData(diffData);

    const lockKey = getLockKey(noteId, branchName, source, toVersionId);

    // 3. Critical Section (I/O Bound - Locked)
    return navigator.locks.request(lockKey, { ifAvailable: false }, async () => {
        try {
            let finalEvent: TimelineEvent;

            await db.transaction('rw', db.timeline, async () => {
                // Check for existing event using the unique compound index
                const existing = await findExistingEvent(noteId, branchName, source, toVersionId);

                // Resolve metadata: explicit input overrides existing
                // Treat undefined as "no update provided", treat empty string as "clear field" (handled below)
                let resolvedName: string | undefined;
                if (metadata && metadata.name !== undefined) {
                    resolvedName = metadata.name;
                } else {
                    resolvedName = existing?.toVersionName;
                }

                let resolvedDescription: string | undefined;
                if (metadata && metadata.description !== undefined) {
                    resolvedDescription = metadata.description;
                } else {
                    resolvedDescription = existing?.toVersionDescription;
                }

                const storedEvent: StoredTimelineEvent = {
                    noteId,
                    branchName,
                    source,
                    fromVersionId,
                    toVersionId,
                    timestamp: toVersionTimestamp,
                    diffData: compressedDiff, // Store compressed
                    stats,
                    toVersionNumber,
                };

                // Handle optional properties explicitly
                // Only store if non-empty string. Empty strings effectively clear the field.
                if (resolvedName !== undefined && resolvedName.trim() !== '') {
                    storedEvent.toVersionName = resolvedName;
                }
                if (resolvedDescription !== undefined && resolvedDescription.trim() !== '') {
                    storedEvent.toVersionDescription = resolvedDescription;
                }

                // Preserve ID for update to maintain referential integrity
                if (existing?.id !== undefined) {
                    storedEvent.id = existing.id;
                }

                // Atomic Put with validation
                validateStoredEventStructure(storedEvent);
                await putTimelineEvent(storedEvent);

                // Reconstruct full event for return (uncompressed)
                finalEvent = {
                    ...storedEvent,
                    diffData: diffData
                };
            });

            return finalEvent!;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new WorkerError(
                'Database transaction failed',
                'DB_ERROR',
                { originalError: message }
            );
        }
    });
}
