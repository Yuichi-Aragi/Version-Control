/**
 * Background Tasks Module
 *
 * This module provides task management components for background operations
 * including periodic auto-saving (watch mode) and cleanup operations.
 *
 * @module core/tasks
 *
 * ## Components
 *
 * - **BackgroundTaskManager**: Manages periodic watch mode auto-saving for both
 *   Version History and Edit History with dual-mode tracking
 * - **CleanupManager**: Handles cleanup of orphaned versions and note directories
 *
 * ## Usage
 *
 * ```typescript
 * import { BackgroundTaskManager } from '@/core/tasks';
 *
 * // Services are accessed via ServiceRegistry
 * const backgroundManager = services.backgroundTaskManager;
 * ```
 */

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

export { BackgroundTaskManager } from './BackgroundTaskManager';
export { CleanupManager } from './cleanup-manager';
