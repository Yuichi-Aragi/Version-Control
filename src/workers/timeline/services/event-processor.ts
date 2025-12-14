/// <reference lib="webworker" />

import { diffLines } from 'diff';
import type { Change } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { decodeContent, sanitizeString, areStringsEqual } from '@/workers/timeline/utils';

/**
 * Event Processing Service
 *
 * This module handles diff computation between content versions.
 */

/**
 * Optimized diff computation with identity check.
 *
 * @param str1 - The first string to compare
 * @param str2 - The second string to compare
 * @returns Array of diff changes
 */
export function computeOptimizedDiff(str1: string, str2: string): Change[] {
    // Early bailout for identical content
    if (areStringsEqual(str1, str2)) {
        return [];
    }

    // Compute line-based diff
    return diffLines(str1, str2, {
        ignoreWhitespace: false,
        newlineIsToken: true
    });
}

/**
 * Processes content and generates diff data.
 * Handles decoding, sanitization, and diff computation.
 *
 * @param content1 - The first content (string or ArrayBuffer)
 * @param content2 - The second content (string or ArrayBuffer)
 * @returns Array of diff changes
 * @throws {WorkerError} If processing fails
 */
export function processContentDiff(
    content1: string | ArrayBuffer,
    content2: string | ArrayBuffer
): Change[] {
    try {
        const str1 = decodeContent(content1);
        const str2 = decodeContent(content2);
        const clean1 = sanitizeString(str1);
        const clean2 = sanitizeString(str2);

        return computeOptimizedDiff(clean1, clean2);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerError(
            'Diff computation failed',
            'DIFF_FAILED',
            { originalError: message }
        );
    }
}
