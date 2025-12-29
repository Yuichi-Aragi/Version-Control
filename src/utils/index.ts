/**
 * Utilities Module
 *
 * This module provides utility functions and helpers used throughout the plugin.
 * Utilities are organized into namespaced exports for clarity and tree-shaking.
 *
 * @module utils
 *
 * ## Namespaces
 *
 * - **file**: File-related utilities (path manipulation, extension handling)
 * - **id**: ID generation utilities (UUID, version IDs)
 * - **lruCache**: LRU cache implementation for caching
 * - **executeWithRetry**: retry utilities (retry logic)
 * - **pathFilter**: Path filtering for include/exclude patterns
 * - **textStats**: Text statistics calculation (word count, character count)
 * - **versions**: Version comparison and sorting utilities
 * - **frontmatter**: Frontmatter manipulation utilities
 *
 * ## Usage
 *
 * ```typescript
 * import { id, file, lruCache, frontmatter } from '@/utils';
 *
 * // Generate a unique ID
 * const noteId = id.generateNoteId();
 *
 * // Check file extension
 * const isMarkdown = file.isMarkdownFile(filePath);
 *
 * // Update frontmatter
 * await frontmatter.updateFrontmatter(app, file, { tags: ['new-tag'] });
 * ```
 */

// ============================================================================
// NAMESPACE EXPORTS
// ============================================================================

export * as file from './file';
export * as id from './id';
export * as lruCache from './LruCache';
export * as executeWithRetry from './retry';
export * as pathFilter from './path-filter/index';
export * as textStats from './text-stats/index';
export * as versions from './versions';
export * as frontmatter from './frontmatter';

// ============================================================================
// DIRECT EXPORTS
// ============================================================================

export { LruCache } from './LruCache';
export type { LruCacheOptions, CacheStats } from './LruCache';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Generic cache interface for consistent caching patterns.
 */
export interface ICache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
    readonly size: number;
}

/**
 * Text statistics result.
 */
export interface TextStats {
    characters: number;
    words: number;
    lines: number;
    paragraphs: number;
}
