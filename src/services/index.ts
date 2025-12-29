/**
 * Services Module
 *
 * This module provides cross-cutting service implementations that support
 * the core business logic. Services handle concerns like diffing, exporting,
 * queue management, and UI notifications.
 *
 * @module services
 *
 * ## Components
 *
 * - **DiffManager**: Computes diffs between versions via web worker with LRU caching
 * - **ExportManager**: Handles version history export in multiple formats (md, json, ndjson, txt)
 * - **QueueService**: Manages keyed p-queue instances for sequential task execution
 * - **UIService**: Provides UI notification capabilities via Obsidian's Notice API
 *
 * ## Usage
 *
 * ```typescript
 * import { DiffManager, type IDiffManager } from '@/services';
 *
 * // Bind to Inversify container
 * container.bind<IDiffManager>(TYPES.DiffManager)
 *   .to(DiffManager).inSingletonScope();
 *
 * // Use via injection
 * constructor(@inject(TYPES.DiffManager) private diffManager: IDiffManager) {}
 *
 * // Compute diff between versions
 * const changes = await this.diffManager.computeDiff(
 *   noteId, v1Id, v2Id, content1, content2, 'line'
 * );
 * ```
 */

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

export { DiffManager } from './diff-manager';
export { ExportManager } from './export-manager';
export { QueueService } from './queue-service';
export { UIService } from './ui-service';
