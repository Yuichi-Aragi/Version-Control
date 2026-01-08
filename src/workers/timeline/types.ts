/// <reference lib="webworker" />

import type { TimelineEvent } from '@/types';
import type { Change } from '@/types';

/**
 * Timeline Worker Types & Error Definitions
 *
 * This module contains all TypeScript interfaces, types, and error
 * definitions used throughout the timeline worker.
 */

// --- Worker Error Definitions ---

/**
 * Custom error class for worker operations with structured error codes.
 */
export class WorkerError extends Error {
    constructor(
        message: string,
        public readonly code: WorkerErrorCode,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'WorkerError';
        Object.setPrototypeOf(this, WorkerError.prototype);
    }
}

/**
 * Type-safe error codes for worker operations.
 * Exported for external use by callers.
 */
export type WorkerErrorCode =
    | 'INVALID_INPUT'
    | 'CONTENT_TOO_LARGE'
    | 'DECODING_FAILED'
    | 'SERIALIZATION_FAILED'
    | 'DIFF_FAILED'
    | 'DB_ERROR'
    | 'DB_UPDATE_FAILED'
    | 'DB_DELETE_FAILED'
    | 'DB_CLEAR_FAILED'
    | 'DB_GLOBAL_CLEAR_FAILED'
    | 'LOCK_TIMEOUT'
    | 'VALIDATION_FAILED'
    | 'CAPACITY_ERROR';

// --- Database Types ---

/**
 * Internal representation of timeline events.
 * Now stores diffData as raw objects (Change[]) without compression.
 */
export interface StoredTimelineEvent extends Omit<TimelineEvent, 'diffData'> {
    /** Raw Change objects */
    diffData: Change[];
}

// --- Re-export for convenience ---

export type { Change };
