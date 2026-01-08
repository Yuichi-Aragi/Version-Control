/**
 * Timeline Worker Configuration
 *
 * This module contains all constants and configuration values
 * used throughout the timeline worker.
 */

/**
 * Name of the IndexedDB database for timeline storage.
 */
export const DB_NAME = 'VersionControlTimelineDB';

/**
 * Maximum content size allowed for diff computation (50MB).
 * This prevents memory exhaustion on extremely large files.
 */
export const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB safety limit for diffing

/**
 * Threshold for identity check optimization (100KB).
 * For content larger than this, we do quick sampling before full comparison.
 */
export const CONTENT_IDENTITY_THRESHOLD = 100 * 1024; // 100KB threshold for identity check optimization

/**
 * Limit for batch delete operations.
 * Prevents transaction overflow in IndexedDB.
 */
export const BATCH_DELETE_LIMIT = 1000; // Prevent transaction overflow
