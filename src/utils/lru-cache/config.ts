/**
 * Configuration constants for LRU Cache implementation.
 * Defines default values and limits for cache operations.
 */

/**
 * Default maximum size for cache keys in characters.
 * Prevents memory exhaustion from excessively large keys.
 */
export const DEFAULT_MAX_KEY_SIZE = 1000;

/**
 * Default timeout for cache operations in milliseconds.
 * Prevents operations from hanging indefinitely.
 */
export const DEFAULT_OPERATION_TIMEOUT = 5000;
