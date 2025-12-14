/// <reference lib="webworker" />

import { MAX_CONTENT_SIZE } from '@/workers/timeline/config';
import { WorkerError } from '@/workers/timeline/types';
import type { StoredTimelineEvent } from '@/workers/timeline/types';

/**
 * Validation Utilities
 *
 * This module provides type guards and validation functions
 * for timeline worker operations.
 */

// --- Type Guards ---

/**
 * Type guard for non-empty strings.
 *
 * @param value - The value to check
 * @returns True if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard for ArrayBuffer instances.
 *
 * @param value - The value to check
 * @returns True if value is an ArrayBuffer
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
    return value instanceof ArrayBuffer;
}

/**
 * Type guard for valid source types.
 *
 * @param value - The value to check
 * @returns True if value is 'version' or 'edit'
 */
export function isValidSource(value: unknown): value is 'version' | 'edit' {
    return value === 'version' || value === 'edit';
}

/**
 * Type guard for valid numbers (finite and not NaN).
 *
 * @param value - The value to check
 * @returns True if value is a valid number
 */
export function isValidNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(value);
}

// --- Validation Functions ---

/**
 * Validates that a value is a non-empty string.
 * Throws WorkerError if validation fails.
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field (for error messages)
 * @returns The validated string
 * @throws {WorkerError} If validation fails
 */
export function validateString(value: unknown, fieldName: string): string {
    if (!isNonEmptyString(value)) {
        throw new WorkerError(
            `Invalid input: ${fieldName} must be a non-empty string`,
            'INVALID_INPUT',
            { field: fieldName, value }
        );
    }
    return value;
}

/**
 * Validates content size and type with early bailout.
 * Throws WorkerError if validation fails.
 *
 * @param content - The content to validate
 * @throws {WorkerError} If content is invalid or too large
 */
export function validateContent(content: string | ArrayBuffer): void {
    if (!(typeof content === 'string' || isArrayBuffer(content))) {
        throw new WorkerError(
            'Content must be string or ArrayBuffer',
            'INVALID_INPUT'
        );
    }

    const encoder = new TextEncoder();
    const size = typeof content === 'string'
        ? encoder.encode(content).byteLength
        : content.byteLength;

    if (size > MAX_CONTENT_SIZE) {
        throw new WorkerError(
            'Content exceeds maximum allowed size for diffing',
            'CONTENT_TOO_LARGE',
            { size, limit: MAX_CONTENT_SIZE }
        );
    }
}

/**
 * Validates the structure of a stored timeline event.
 * Throws WorkerError if validation fails.
 *
 * @param event - The event to validate
 * @throws {WorkerError} If validation fails
 */
export function validateStoredEventStructure(event: unknown): asserts event is StoredTimelineEvent {
    if (!event || typeof event !== 'object') {
        throw new WorkerError('Invalid event structure', 'VALIDATION_FAILED');
    }

    const e = event as Record<string, unknown>;

    // Use bracket notation to avoid TS4111 (noPropertyAccessFromIndexSignature)
    if (!isNonEmptyString(e['noteId']) ||
        !isNonEmptyString(e['branchName']) ||
        !isValidSource(e['source']) ||
        !isNonEmptyString(e['toVersionId']) ||
        !isNonEmptyString(e['timestamp']) ||
        !isValidNumber(e['toVersionNumber'])) {
        throw new WorkerError('Invalid event fields', 'VALIDATION_FAILED');
    }

    if (!isArrayBuffer(e['diffData'])) {
        throw new WorkerError('diffData must be ArrayBuffer', 'VALIDATION_FAILED');
    }
}
