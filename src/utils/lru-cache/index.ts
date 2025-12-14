/**
 * LRU Cache Module
 *
 * A robust, enterprise-grade LRU (Least Recently Used) cache implementation.
 * Provides efficient caching with automatic eviction of least recently used items.
 *
 * @module lru-cache
 *
 * ## Features
 *
 * - Fixed-size cache with LRU eviction policy
 * - Type-safe generic implementation
 * - Async operations with timeout protection
 * - Defensive validation and error handling
 * - Memory exhaustion prevention
 * - Cache statistics and monitoring
 *
 * ## Usage
 *
 * ```typescript
 * import { LruCache } from '@/utils/lru-cache';
 *
 * // Create cache with capacity of 100 items
 * const cache = new LruCache<string, User>(100);
 *
 * // Store values
 * await cache.set('user-1', { name: 'Alice', age: 30 });
 *
 * // Retrieve values
 * const user = await cache.get('user-1');
 *
 * // Check existence
 * const exists = await cache.has('user-1');
 *
 * // Get statistics
 * const stats = await cache.getStats();
 * console.log(`Cache utilization: ${stats.utilization * 100}%`);
 * ```
 */

// Re-export main class
export { LruCache } from './lru-cache';

// Re-export types
export type { LruCacheOptions, CacheStats } from './types';

// Re-export configuration constants (useful for testing/configuration)
export { DEFAULT_MAX_KEY_SIZE, DEFAULT_OPERATION_TIMEOUT } from './config';
