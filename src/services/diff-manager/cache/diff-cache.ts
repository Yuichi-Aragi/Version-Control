/**
 * Specialized LRU cache for diff results
 */

import { LruCache } from '@/utils/lru-cache';
import type { Change } from '@/types';
import { DIFF_CACHE_CAPACITY } from '@/services/diff-manager/config';

export class DiffCache {
    private readonly cache: LruCache<string, Change[]>;

    constructor() {
        this.cache = new LruCache(DIFF_CACHE_CAPACITY, {
            maxKeySize: 500,
            operationTimeout: 5000
        });
    }

    async has(key: string): Promise<boolean> {
        return this.cache.has(key);
    }

    async get(key: string): Promise<Change[] | undefined> {
        return this.cache.get(key);
    }

    async set(key: string, value: Change[]): Promise<void> {
        await this.cache.set(key, value);
    }

    async delete(key: string): Promise<void> {
        await this.cache.delete(key);
    }

    async keys(): Promise<string[]> {
        const iterator = await this.cache.keys();
        return Array.from(iterator);
    }

    async clear(): Promise<void> {
        await this.cache.clear();
    }

    async getStats(): Promise<{
        size: number;
        capacity: number;
        utilization: number;
    }> {
        return this.cache.getStats();
    }
}
