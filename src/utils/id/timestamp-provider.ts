/**
 * Timestamp formatting utilities for ID generation
 *
 * @module id-utils/timestamp-provider
 */

/**
 * Generates a sortable timestamp in YYYYMMDDHHmmss format
 *
 * @param date - The date to format (defaults to current date)
 * @returns Formatted timestamp string
 *
 * @remarks
 * Format: YYYYMMDDHHmmss (optimized for sorting)
 *
 * @example
 * ```typescript
 * generateSortableTimestamp() // Returns '20241225120000'
 * generateSortableTimestamp(new Date('2024-12-25T12:00:00')) // Returns '20241225120000'
 * ```
 */
export function generateSortableTimestamp(date?: Date): string {
    const d = date || new Date();

    return d.getFullYear().toString().padStart(4, '0') +
           (d.getMonth() + 1).toString().padStart(2, '0') +
           d.getDate().toString().padStart(2, '0') +
           d.getHours().toString().padStart(2, '0') +
           d.getMinutes().toString().padStart(2, '0') +
           d.getSeconds().toString().padStart(2, '0');
}

/**
 * Generates a millisecond timestamp
 *
 * @param customTimestamp - Optional custom timestamp to use instead of current time
 * @returns Timestamp string in milliseconds
 *
 * @example
 * ```typescript
 * generateMillisecondTimestamp() // Returns '1703505600000'
 * generateMillisecondTimestamp(1703505600000) // Returns '1703505600000'
 * ```
 */
export function generateMillisecondTimestamp(customTimestamp?: string | number): string {
    if (customTimestamp !== undefined && customTimestamp !== null) {
        return String(customTimestamp);
    }
    return Date.now().toString();
}
