/**
 * Cleanup Manager Module
 *
 * Manages all cleanup operations including:
 * - Retention policy-based version cleanup
 * - Orphaned version data cleanup
 * - Scheduled and debounced cleanup operations
 *
 * @module core/tasks/cleanup-manager
 */

export { CleanupManager } from './CleanupManager';
export type { CleanupResult } from './types';
