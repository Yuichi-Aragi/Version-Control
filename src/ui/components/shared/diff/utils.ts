import { isString } from 'es-toolkit';
import type { Change, DiffType } from '@/types';

/**
 * Robust escapeRegExp implementation.
 */
export const escapeRegExp = (string: string): string => {
    if (!isString(string)) {
        return '';
    }
    // Escape regex special characters
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Type-safe assertion function.
 */
export function invariant(
    condition: unknown,
    message?: string
): asserts condition {
    if (!condition) {
        throw new Error(message || 'Invariant violation');
    }
}

/**
 * Validates a single Change object.
 */
export function validateChange(change: Change): void {
    invariant(
        change !== null && typeof change === 'object',
        'Change must be a non-null object'
    );
    invariant(
        isString(change.value),
        'Change value must be a string'
    );
    invariant(
        !(change.added && change.removed),
        'Change cannot be both added and removed'
    );
}

/**
 * Validates changes array.
 */
export function validateChanges(changes: readonly Change[]): void {
    invariant(Array.isArray(changes), 'Changes must be an array');
    changes.forEach(validateChange);
}

/**
 * Validates diffType against known values.
 */
export function validateDiffType(diffType: DiffType): void {
    const validTypes: readonly DiffType[] = ['lines', 'words', 'chars', 'smart'];
    invariant(
        validTypes.includes(diffType),
        `Invalid diffType: ${diffType}. Must be one of: ${validTypes.join(', ')}`
    );
}
