/// <reference lib="webworker" />

import { makeDiff, type Diff, DIFF_DELETE, DIFF_INSERT } from '@sanity/diff-match-patch';
import type { Change } from '@/workers/timeline/types';
import { WorkerError } from '@/workers/timeline/types';
import { decodeContent, sanitizeString, areStringsEqual } from '@/workers/timeline/utils';

/**
 * Event Processing Service
 *
 * This module handles diff computation between content versions.
 * 
 * ENHANCEMENT:
 * Implements strict line-level diffing. This ensures that the timeline
 * reflects changes at the line granularity, rather than word or character
 * granularity, which is more appropriate for version history visualization.
 */

/**
 * Splits two texts into an array of strings. Reduce the texts to a string of
 * hashes where each Unicode character represents one line.
 * 
 * This ensures strict line-level diffing by treating lines as atomic units.
 */
function linesToChars(textA: string, textB: string): { chars1: string; chars2: string; lineArray: string[] } {
    const lineArray: string[] = [];
    const lineHash: { [key: string]: number } = {};
    
    // ' \x00' is a valid character, but various debuggers don't like it.
    // So we'll insert a junk entry to avoid generating a null character.
    lineArray[0] = '';

    function diffLinesToMunge(text: string, maxLinesValue: number): string {
        let chars = '';
        let lineStart = 0;
        let lineEnd = -1;
        let lineArrayLength = lineArray.length;

        while (lineEnd < text.length - 1) {
            lineEnd = text.indexOf('\n', lineStart);
            if (lineEnd === -1) {
                lineEnd = text.length - 1;
            }
            let line = text.slice(lineStart, lineEnd + 1);

            if (Object.prototype.hasOwnProperty.call(lineHash, line)) {
                // Use non-null assertion because hasOwnProperty check guarantees existence
                chars += String.fromCharCode(lineHash[line]!);
            } else {
                if (lineArrayLength === maxLinesValue) {
                    // Bail out at 65535 to avoid overflow
                    line = text.slice(lineStart);
                    lineEnd = text.length;
                }
                chars += String.fromCharCode(lineArrayLength);
                lineHash[line] = lineArrayLength;
                lineArray[lineArrayLength++] = line;
            }
            lineStart = lineEnd + 1;
        }
        return chars;
    }

    // Allocate 2/3rds of the space for textA, the rest for textB.
    const chars1 = diffLinesToMunge(textA, 40000);
    const chars2 = diffLinesToMunge(textB, 65535);

    return { chars1, chars2, lineArray };
}

/**
 * Rehydrate the text in a diff from a string of line hashes to real lines of text.
 */
function charsToLines(diffs: Diff[], lineArray: string[]): void {
    for (let x = 0; x < diffs.length; x++) {
        const currentDiff = diffs[x];
        if (!currentDiff) continue;

        const chars = currentDiff[1];
        const text: string[] = [];
        for (let y = 0; y < chars.length; y++) {
            const line = lineArray[chars.charCodeAt(y)];
            if (line !== undefined) {
                text[y] = line;
            }
        }
        currentDiff[1] = text.join('');
    }
}

/**
 * Counts lines in a text string accurately.
 * Handles edge cases: empty strings, strings ending with newlines.
 */
function countLines(text: string): number {
    if (text.length === 0) return 0;

    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            count++;
        }
    }
    // If text ends with newline, the final "line" is empty and shouldn't be counted as content
    if (text.endsWith('\n')) {
        count--;
    }
    return count || 1;
}

/**
 * Converts @sanity/diff-match-patch diffs to Change[] format.
 */
function diffsToChanges(diffs: Diff[]): Change[] {
    const changes: Change[] = [];

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        if (diff === undefined) continue;

        const [op, text] = diff;

        // Skip empty diffs
        if (text.length === 0) continue;

        const change: Change = {
            value: text,
            added: op === DIFF_INSERT ? true : undefined,
            removed: op === DIFF_DELETE ? true : undefined,
            count: countLines(text),
        };

        changes.push(change);
    }

    return changes;
}

/**
 * Optimized diff computation with strict line mode.
 * 
 * This function guarantees that:
 * 1. Diffs are calculated strictly at the line level (no word/char mixing).
 * 2. Even minor changes (e.g. one char) result in the whole line being marked as changed.
 * 3. Data integrity is preserved by processing the full content.
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

    // 1. Convert lines to chars (Strict Line Mode Step 1)
    const { chars1, chars2, lineArray } = linesToChars(str1, str2);

    // 2. Compute diff on chars (which represent lines)
    // checkLines: false because we are already handling lines manually via linesToChars
    const diffs = makeDiff(chars1, chars2, {
        checkLines: false, // We handle lines manually
        timeout: 10 // 10 seconds timeout
    });

    // 3. Convert chars back to lines (Strict Line Mode Step 2)
    charsToLines(diffs, lineArray);

    // Note: We intentionally DO NOT use cleanupSemantic here.
    // Semantic cleanup can sometimes merge small changes into larger contexts or 
    // split lines in ways that violate strict line-diff requirements.
    // The linesToChars approach naturally produces clean line-level diffs.

    // 4. Convert to application Change format
    return diffsToChanges(diffs);
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
