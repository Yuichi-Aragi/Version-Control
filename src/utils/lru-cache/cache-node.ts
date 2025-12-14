/**
 * Cache node/entry implementation.
 *
 * This LRU cache implementation uses JavaScript's native Map data structure,
 * which maintains insertion order. This eliminates the need for a separate
 * linked list node implementation, as Map provides O(1) insertion, deletion,
 * and reordering operations while automatically maintaining order.
 *
 * Design Decision:
 * - Map-based approach is more memory-efficient than traditional doubly-linked list
 * - Leverages browser/runtime optimizations for Map operations
 * - Simpler implementation with fewer moving parts
 * - No manual pointer management required
 *
 * The cache achieves LRU semantics by:
 * 1. Deleting and re-inserting items on access (moves to end)
 * 2. Evicting from the front (Map.keys().next().value)
 * 3. Adding new items at the end (Map.set())
 */

/**
 * No explicit node class is needed for this implementation.
 * Map entries serve as implicit nodes with the following structure:
 *
 * - Key: K (generic key type)
 * - Value: V (generic value type)
 * - Order: Maintained by Map's insertion order
 */
export {};
