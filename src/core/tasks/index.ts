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
 * import { BackgroundTaskManager, type IBackgroundTaskManager } from '@/core/tasks';
 *
 * // Bind to Inversify container
 * container.bind<IBackgroundTaskManager>(TYPES.BackgroundTaskManager)
 *   .to(BackgroundTaskManager).inSingletonScope();
 * ```
 */

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

export { BackgroundTaskManager } from './BackgroundTaskManager';
export { CleanupManager } from './cleanup-manager';

// ============================================================================
// INTERFACE RE-EXPORTS
// ============================================================================

export type {
    IBackgroundTaskManager,
    ICleanupManager,
    CleanupResult,
} from '@/types/interfaces';
