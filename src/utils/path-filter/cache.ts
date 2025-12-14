/**
 * CACHE MANAGEMENT
 *
 * LRU cache implementation for compiled regex patterns with TTL and size limits.
 */

import type { RegexCacheEntry, PerformanceMetrics, CacheStats } from '@/utils/path-filter/types';
import { MAX_CACHE_SIZE, CACHE_TTL_MS } from '@/utils/path-filter/config';

/** LRU cache for compiled regex patterns with TTL and size limits */
export class RegexCache {
    private cache = new Map<string, RegexCacheEntry>();
    private metrics: PerformanceMetrics = {
        cacheHits: 0,
        cacheMisses: 0,
        compilations: 0,
        validationFailures: 0,
        totalProcessed: 0
    };

    /** Get compiled regex with LRU update */
    get(pattern: string): RegExp | null {
        this.metrics.totalProcessed++;

        const entry = this.cache.get(pattern);
        if (entry) {
            this.metrics.cacheHits++;
            // Update LRU order by deleting and re-inserting
            this.cache.delete(pattern);
            this.cache.set(pattern, {
                ...entry,
                timestamp: Date.now(),
                hitCount: entry.hitCount + 1
            });
            return entry.regex;
        }

        this.metrics.cacheMisses++;
        return null;
    }

    /** Store compiled regex with cache management */
    set(pattern: string, regex: RegExp): void {
        this.metrics.compilations++;

        // Clean up expired entries before adding new one
        this.cleanupExpired();

        // Enforce maximum cache size
        if (this.cache.size >= MAX_CACHE_SIZE) {
            this.evictLRU();
        }

        this.cache.set(pattern, {
            regex,
            timestamp: Date.now(),
            hitCount: 1
        });
    }

    /** Remove expired cache entries (older than TTL) */
    private cleanupExpired(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];

        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > CACHE_TTL_MS) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => this.cache.delete(key));
    }

    /** Evict least recently used entry */
    private evictLRU(): void {
        if (this.cache.size === 0) return;

        let oldestKey: string | null = null;
        let oldestTime = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /** Clear all cache entries */
    clear(): void {
        this.cache.clear();
        this.resetMetrics();
    }

    /** Get current cache statistics */
    getStats(): CacheStats {
        const totalAccesses = this.metrics.cacheHits + this.metrics.cacheMisses;
        const hitRate = totalAccesses > 0
            ? (this.metrics.cacheHits / totalAccesses) * 100
            : 0;

        return {
            size: this.cache.size,
            hits: this.metrics.cacheHits,
            misses: this.metrics.cacheMisses,
            hitRate: parseFloat(hitRate.toFixed(2))
        };
    }

    /** Reset performance metrics */
    private resetMetrics(): void {
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            compilations: 0,
            validationFailures: 0,
            totalProcessed: 0
        };
    }
}

// Global regex cache instance
export const regexCache = new RegexCache();
