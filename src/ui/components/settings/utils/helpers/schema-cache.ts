import * as v from 'valibot';
import type { CacheEntry } from '@/ui/components/settings/utils/types';

/**
 * LRU cache for Valibot schemas with bounded memory usage
 */
export class SchemaCache {
    private static readonly MAX_SIZE = 100;

    private static instance: SchemaCache;

    private cache = new Map<string, CacheEntry>();


    private constructor() {}

    static getInstance(): SchemaCache {
        if (!SchemaCache.instance) {
            SchemaCache.instance = new SchemaCache();
        }
        return SchemaCache.instance;
    }

    get<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        // Update access time
        entry.lastAccess = Date.now();
        this.cache.set(key, entry);

        return entry.schema as T;
    }

    set(key: string, schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>): void {
        // Implement LRU eviction if at capacity
        if (this.cache.size >= SchemaCache.MAX_SIZE) {
            let oldestKey = '';
            let oldestTime = Infinity;

            for (const [k, entry] of this.cache.entries()) {
                if (entry.lastAccess < oldestTime) {
                    oldestTime = entry.lastAccess;
                    oldestKey = k;
                }
            }

            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            schema,
            lastAccess: Date.now()
        });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * Clears the schema cache (useful for testing)
 */
export const clearSchemaCache = (): void => {
    SchemaCache.getInstance().clear();
};

/**
 * Gets current cache size
 */
export const getCacheSize = (): number => {
    return SchemaCache.getInstance().size();
};
