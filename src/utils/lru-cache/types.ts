/**
 * Type definitions for the LRU Cache implementation.
 * Defines all interfaces and type aliases used across the cache modules.
 */

/**
 * Configuration options for LRU Cache constructor.
 */
export interface LruCacheOptions {
    /**
     * Maximum size for cache keys in characters.
     * Prevents memory exhaustion from excessively large keys.
     * @default 1000
     */
    maxKeySize?: number;

    /**
     * Timeout for cache operations in milliseconds.
     * Prevents operations from hanging indefinitely.
     * @default 5000
     */
    operationTimeout?: number;
}

/**
 * Statistics about the cache state and performance.
 */
export interface CacheStats {
    /**
     * Current number of items in the cache.
     */
    size: number;

    /**
     * Maximum capacity of the cache.
     */
    capacity: number;

    /**
     * Utilization ratio (size/capacity).
     * Value between 0 and 1.
     */
    utilization: number;

    /**
     * Whether the cache has been destroyed.
     */
    isDestroyed: boolean;
}
