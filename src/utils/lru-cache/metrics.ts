/**
 * Cache metrics and statistics tracking.
 * Provides performance monitoring and diagnostic information.
 */

import type { CacheStats } from './types';

/**
 * Calculates cache statistics.
 *
 * @param size - Current cache size
 * @param capacity - Maximum cache capacity
 * @param isDestroyed - Whether cache is destroyed
 * @returns Cache statistics object
 */
export function calculateStats(
    size: number,
    capacity: number,
    isDestroyed: boolean
): CacheStats {
    return {
        size,
        capacity,
        utilization: capacity > 0 ? size / capacity : 0,
        isDestroyed
    };
}

/**
 * Creates a fallback stats object when calculation fails.
 *
 * @param capacity - Cache capacity
 * @param isDestroyed - Whether cache is destroyed
 * @returns Fallback statistics object with zero size
 */
export function createFallbackStats(
    capacity: number,
    isDestroyed: boolean
): CacheStats {
    return {
        size: 0,
        capacity,
        utilization: 0,
        isDestroyed
    };
}
