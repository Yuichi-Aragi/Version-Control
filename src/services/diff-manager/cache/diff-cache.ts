/**
 * Specialized LRU cache for diff results with optimized performance.
 * Uses simple Map-based LRU implementation for maximum efficiency.
 */

import { LruCache } from '@/utils/LruCache';
import type { Change } from '@/types';
import { DIFF_CACHE_CAPACITY } from '@/services/diff-manager/config';

export class DiffCache {
    private readonly cache: LruCache<string, Change[]>;

    constructor() {
        this.cache = new LruCache(DIFF_CACHE_CAPACITY);
    }

    /**
     * Checks if a key exists in the cache.
     */
    async has(key: string): Promise<boolean> {
        return this.cache.has(key);
    }

    /**
     * Gets a cached diff result.
     */
    async get(key: string): Promise<Change[] | undefined> {
        return this.cache.get(key);
    }

    /**
     * Stores a diff result in the cache.
     */
    async set(key: string, value: Change[]): Promise<void> {
        this.cache.set(key, value);
    }

    /**
     * Deletes a key from the cache.
     */
    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    /**
     * Returns all cache keys.
     */
    async keys(): Promise<string[]> {
        return Array.from(this.cache.keys());
    }

    /**
     * Clears all cached diff results.
     */
    async clear(): Promise<void> {
        this.cache.clear();
    }

    /**
     * Gets cache statistics.
     */
    async getStats(): Promise<{
        size: number;
        capacity: number;
        utilization: number;
    }> {
        const stats = this.cache.getStats();
        return {
            size: stats.size,
            capacity: stats.capacity,
            utilization: stats.utilization
        };
    }
}
