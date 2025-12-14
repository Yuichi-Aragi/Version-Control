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
 * - **network**: Network utilities (retry logic, fetch helpers)
 * - **pathFilter**: Path filtering for include/exclude patterns
 * - **textStats**: Text statistics calculation (word count, character count)
 * - **versions**: Version comparison and sorting utilities
 *
 * ## Usage
 *
 * ```typescript
 * import { id, file, lruCache } from '@/utils';
 *
 * // Generate a unique ID
 * const noteId = id.generateNoteId();
 *
 * // Check file extension
 * const isMarkdown = file.isMarkdownFile(filePath);
 *
 * // Create LRU cache
 * const cache = new lruCache.LruCache<string, DiffResult>(100);
 * ```
 */

// ============================================================================
// NAMESPACE EXPORTS
// ============================================================================

export * as file from './file';
export * as id from './id';
export * as lruCache from './lru-cache';
export * as network from './network';
export * as pathFilter from './path-filter/index';
export * as textStats from './text-stats/index';
export * as versions from './versions';

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
 * Configuration for retry operations.
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
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
