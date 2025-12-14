/**
 * TYPE DEFINITIONS
 *
 * Core TypeScript interfaces and types for the path filter module.
 */

/** Cache entry for compiled regex patterns */
export interface RegexCacheEntry {
    readonly regex: RegExp;
    readonly timestamp: number;
    readonly hitCount: number;
}

/** Performance metrics for monitoring */
export interface PerformanceMetrics {
    cacheHits: number;
    cacheMisses: number;
    compilations: number;
    validationFailures: number;
    totalProcessed: number;
}

/** Comprehensive validation result */
export interface ValidationResult<T> {
    readonly isValid: boolean;
    readonly value?: T;
    readonly error?: string;
    readonly sanitized?: string;
}

/** Cache statistics for monitoring and debugging */
export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
}

/** Settings interface for path filtering */
export interface PathFilterSettings {
    pathFilters?: unknown;
}
