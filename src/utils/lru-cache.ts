/**
 * A simple implementation of a fixed-size LRU (Least Recently Used) cache.
 * It uses a Map to store key-value pairs, which maintains insertion order.
 * When an item is accessed (get) or updated (set), it's moved to the end of the
 * map's insertion order, marking it as the most recently used. When the cache
 * reaches capacity, the least recently used item (the first one in the map) is evicted.
 */
export class LruCache<K, V> {
    private capacity: number;
    private cache: Map<K, V>;

    /**
     * @param capacity The maximum number of items the cache can hold. Must be > 0.
     */
    constructor(capacity: number) {
        if (capacity <= 0) {
            throw new Error("LRU Cache capacity must be a positive number.");
        }
        this.capacity = capacity;
        this.cache = new Map<K, V>();
    }

    /**
     * Retrieves an item from the cache. If found, it's marked as most recently used.
     * @param key The key of the item to retrieve.
     * @returns The value associated with the key, or undefined if not found.
     */
    get(key: K): V | undefined {
        if (!this.cache.has(key)) {
            return undefined;
        }
        const value = this.cache.get(key)!;
        // Move to end to mark as recently used
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    /**
     * Adds or updates an item in the cache, marking it as most recently used.
     * If the cache is at capacity, the least recently used item is evicted.
     * @param key The key of the item to set.
     * @param value The value of the item.
     */
    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            // If key already exists, just delete it so we can re-insert it at the end
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            // Evict the least recently used item (the first key in the map's insertion order)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    /**
     * Checks if an item exists in the cache without updating its usage.
     * @param key The key to check.
     * @returns True if the item exists, false otherwise.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Removes an item from the cache.
     * @param key The key of the item to delete.
     * @returns True if an element in the Map existed and has been removed, or false if the element does not exist.
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * Returns an iterator for the keys in the cache, from least to most recently used.
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * Removes all items from the cache.
     */
    clear(): void {
        this.cache.clear();
    }
}
