/**
 * VERSION CONTROL PATH FILTER MODULE
 *
 * Optimized, hardened, and production-ready implementation
 * with comprehensive validation, security, and performance optimizations.
 *
 * @module path-filter
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type { ValidationResult, CacheStats, PathFilterSettings } from '@/utils/path-filter/types';

// ============================================================================
// CORE FUNCTIONALITY
// ============================================================================

export { isPathAllowed } from '@/utils/path-filter/filter-engine';

// ============================================================================
// PUBLIC UTILITIES
// ============================================================================

import { regexCache } from '@/utils/path-filter/cache';
import { validatePattern, validatePath } from '@/utils/path-filter/validation';
import type { ValidationResult, CacheStats } from '@/utils/path-filter/types';

/**
 * Cleanup function to be called when the module is unloaded.
 * Releases all cached resources and resets internal state.
 */
export function cleanup(): void {
    regexCache.clear();
}

/**
 * Get cache statistics for monitoring and debugging.
 *
 * @returns Current cache statistics including size, hits, misses, and hit rate
 */
export function getCacheStats(): CacheStats {
    return regexCache.getStats();
}

/**
 * Force cache invalidation and cleanup.
 * Useful for testing or when patterns need to be recompiled.
 */
export function invalidateCache(): void {
    regexCache.clear();
}

/**
 * Validate and sanitize a single pattern without caching.
 * Useful for testing pattern validity before adding to settings.
 *
 * @param pattern - Pattern to validate
 * @returns Validation result with sanitized pattern if valid
 */
export function validateSinglePattern(pattern: unknown): ValidationResult<string> {
    return validatePattern(pattern);
}

/**
 * Validate and sanitize a single path.
 * Useful for testing path validity before processing.
 *
 * @param path - Path to validate
 * @returns Validation result with sanitized path if valid
 */
export function validateSinglePath(path: unknown): ValidationResult<string> {
    return validatePath(path);
}
