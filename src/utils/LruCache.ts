/**
 * Simplified LRU Cache implementation using ES6 Map.
 * 
 * This implementation provides O(1) amortized time complexity for get/set operations
 * by leveraging Map's ordered iteration and native LRU semantics through delete+reinsert.
 * 
 * Design rationale:
 * - Map maintains insertion order, making it ideal for LRU implementation
 * - Delete+reinsert on access automatically moves items to end (most recently used)
 * - No need for complex linked list or timestamp tracking
 * - Native JavaScript engine optimizations for Map operations
 * 
 * Performance characteristics:
 * - get(): O(1) amortized (delete + set = O(1) each)
 * - set(): O(1) amortized (check + optional delete + set = O(1))
 * - has(): O(1)
 * - delete(): O(1)
 * - Memory: O(n) where n = cache capacity
 */

export interface LruCacheOptions {
    /** Maximum number of items to cache (default: 100) */
    maxSize?: number;
}

export interface CacheStats {
    /** Current number of items in cache */
    size: number;
    /** Maximum capacity */
    capacity: number;
    /** Utilization ratio (size/capacity) */
    utilization: number;
    /** Whether cache has been destroyed */
    isDestroyed: boolean;
}

/**
 * LRU Cache with simple Map-based implementation.
 * Automatically evicts least recently used items when at capacity.
 */
export class LruCache<K, V> {
    private readonly maxSize: number;
    private cache: Map<K, V>;
    private destroyed = false;

    /**
     * Creates a new LRU Cache.
     * @param maxSize Maximum number of items to store (default: 100)
     */
    constructor(maxSize: number = 100) {
        if (maxSize <= 0 || !Number.isFinite(maxSize) || !Number.isInteger(maxSize)) {
            throw new Error('Cache maxSize must be a positive integer');
        }
        
        this.maxSize = maxSize;
        this.cache = new Map<K, V>();
    }

    /**
     * Gets a value from the cache.
     * If found, marks the item as most recently used.
     * @param key The key to look up
     * @returns The cached value or undefined if not found
     */
    get(key: K): V | undefined {
        if (this.destroyed) {
            return undefined;
        }

        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used) by deleting and reinserting
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    /**
     * Sets a value in the cache.
     * If cache is at capacity, evicts least recently used item first.
     * @param key The key to store
     * @param value The value to cache
     */
    set(key: K, value: V): void {
        if (this.destroyed) {
            return;
        }

        // If key exists, delete it (will be reinserted at end)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Evict LRU item if at capacity (before adding new item)
        if (this.cache.size >= this.maxSize) {
            const lruKey = this.cache.keys().next().value;
            if (lruKey !== undefined) {
                this.cache.delete(lruKey);
            }
        }

        // Insert new/updated item (automatically at end = most recently used)
        this.cache.set(key, value);
    }

    /**
     * Checks if a key exists in the cache without updating access order.
     * @param key The key to check
     * @returns true if key exists, false otherwise
     */
    has(key: K): boolean {
        if (this.destroyed) {
            return false;
        }
        return this.cache.has(key);
    }

    /**
     * Deletes a key from the cache.
     * @param key The key to delete
     * @returns true if key existed and was deleted, false otherwise
     */
    delete(key: K): boolean {
        if (this.destroyed) {
            return false;
        }
        return this.cache.delete(key);
    }

    /**
     * Clears all items from the cache.
     */
    clear(): void {
        if (this.destroyed) {
            return;
        }
        this.cache.clear();
    }

    /**
     * Returns the current number of items in the cache.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Returns the maximum capacity of the cache.
     */
    getCapacity(): number {
        return this.maxSize;
    }

    /**
     * Gets cache statistics.
     */
    getStats(): CacheStats {
        return {
            size: this.cache.size,
            capacity: this.maxSize,
            utilization: this.cache.size / this.maxSize,
            isDestroyed: this.destroyed
        };
    }

    /**
     * Destroys the cache and releases all resources.
     */
    destroy(): void {
        this.cache.clear();
        this.destroyed = true;
    }

    /**
     * Checks if the cache has been destroyed.
     */
    isDestroyed(): boolean {
        return this.destroyed;
    }

    /**
     * Returns an iterator for all keys in the cache (LRU to MRU order).
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * Returns an iterator for all values in the cache (LRU to MRU order).
     */
    values(): IterableIterator<V> {
        return this.cache.values();
    }

    /**
     * Returns an iterator for all entries in the cache (LRU to MRU order).
     */
    entries(): IterableIterator<[K, V]> {
        return this.cache.entries();
    }

    /**
     * Executes a callback for each entry in the cache.
     * @param callbackfn Function to execute for each entry
     * @param thisArg Value to use as this when executing callback
     */
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
        this.cache.forEach(callbackfn, thisArg);
    }
}
