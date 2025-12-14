/**
 * Cache key generation utilities
 */

import type { DiffType } from '@/types';

export class CacheKeyGenerator {
    static generate(noteId: string, id1: string, id2: string, diffType: DiffType): string {
        return `${noteId}:${id1}:${id2}:${diffType}`;
    }

    static getNotePrefixPattern(noteId: string): string {
        return `${noteId}:`;
    }
}
