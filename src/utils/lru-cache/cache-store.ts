/**
 * Core LRU cache storage operations.
 * Manages the underlying Map storage and implements LRU access patterns.
 */

import { handleEviction } from './eviction-policy';

/**
 * Internal cache store that manages the Map and key tracking.
 */
export class CacheStore<K, V> {
    private readonly cache: Map<K, V>;
    private readonly keySet: Set<K>;
    private readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.cache = new Map<K, V>();
        this.keySet = new Set<K>();
    }

    /**
     * Gets a value from the cache and marks it as recently used.
     * Returns undefined if key doesn't exist.
     */
    get(key: K): V | undefined {
        if (!this.cache.has(key)) {
            return undefined;
        }

        const value = this.cache.get(key)!;

        // Optimize: Only reorder if cache has more than one item
        if (this.cache.size > 1) {
            // Move to end to mark as recently used
            this.cache.delete(key);
            this.cache.set(key, value);
        }

        return value;
    }

    /**
     * Sets a value in the cache, marking it as most recently used.
     * Evicts LRU item if at capacity.
     */
    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            // If key exists, delete it to re-insert at end (maintains LRU order)
            this.cache.delete(key);
        } else {
            // Handle eviction if at capacity and adding new item
            handleEviction(this.cache, this.keySet, this.capacity, key);
        }

        // Always add the new/updated item
        this.cache.set(key, value);
        this.keySet.add(key);
    }

    /**
     * Checks if a key exists in the cache without updating usage.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Deletes a key from the cache.
     * Returns true if the key existed and was removed.
     */
    delete(key: K): boolean {
        const result = this.cache.delete(key);
        if (result) {
            this.keySet.delete(key);
        }
        return result;
    }

    /**
     * Clears all entries from the cache.
     */
    clear(): void {
        this.cache.clear();
        this.keySet.clear();
    }

    /**
     * Returns an iterator for cache keys (least to most recently used).
     */
    keys(): IterableIterator<K> {
        // Create defensive copy to prevent external modification
        return new Map(this.cache).keys();
    }

    /**
     * Returns an iterator for cache values (least to most recently used).
     */
    values(): IterableIterator<V> {
        // Create defensive copy to prevent external modification
        return new Map(this.cache).values();
    }

    /**
     * Returns an iterator for cache entries (least to most recently used).
     */
    entries(): IterableIterator<[K, V]> {
        // Create defensive copy to prevent external modification
        return new Map(this.cache).entries();
    }

    /**
     * Executes a callback for each entry in the cache.
     */
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        // Create defensive copy to iterate over
        const copy = new Map(this.cache);
        copy.forEach(callbackfn, thisArg);
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
    get maxCapacity(): number {
        return this.capacity;
    }

    /**
     * Internal method to force reinitialize cache (for recovery scenarios).
     */
    reinitialize(): { cache: Map<K, V>; keySet: Set<K> } {
        const newCache = new Map<K, V>();
        const newKeySet = new Set<K>();
        return { cache: newCache, keySet: newKeySet };
    }

    /**
     * Gets direct access to internal cache (for recovery scenarios).
     */
    getInternalCache(): Map<K, V> {
        return this.cache;
    }

    /**
     * Gets direct access to internal key set (for recovery scenarios).
     */
    getInternalKeySet(): Set<K> {
        return this.keySet;
    }
}
