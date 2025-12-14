/**
 * Eviction policy implementation for LRU cache.
 * Handles eviction strategies including LRU (Least Recently Used) eviction.
 */

/**
 * Evicts the least recently used item from the cache.
 * Uses Map's insertion order - the first key is always the LRU item.
 *
 * @param cache - The cache Map to evict from
 * @param keySet - The key tracking Set to update
 * @returns The evicted key if eviction occurred, undefined otherwise
 */
export function evictLru<K, V>(cache: Map<K, V>, keySet: Set<K>): K | undefined {
    if (cache.size === 0) {
        return undefined;
    }

    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
        cache.delete(firstKey);
        keySet.delete(firstKey);
        return firstKey;
    }

    return undefined;
}

/**
 * Checks if eviction is needed based on capacity and whether adding a new key.
 *
 * @param cache - The cache Map to check
 * @param capacity - Maximum capacity of the cache
 * @param key - The key being added or updated
 * @returns True if eviction is needed, false otherwise
 */
export function shouldEvict<K, V>(
    cache: Map<K, V>,
    capacity: number,
    key: K
): boolean {
    // No eviction needed if key already exists (updating)
    if (cache.has(key)) {
        return false;
    }

    // Eviction needed if at capacity and adding new key
    return cache.size >= capacity;
}

/**
 * Handles the eviction process when at capacity.
 * Evicts the LRU item if necessary before adding a new item.
 *
 * @param cache - The cache Map
 * @param keySet - The key tracking Set
 * @param capacity - Maximum capacity
 * @param key - The key being added
 */
export function handleEviction<K, V>(
    cache: Map<K, V>,
    keySet: Set<K>,
    capacity: number,
    key: K
): void {
    if (shouldEvict(cache, capacity, key)) {
        evictLru(cache, keySet);
    }
}
