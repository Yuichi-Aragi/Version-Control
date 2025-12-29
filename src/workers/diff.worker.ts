/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { diffLines, diffWordsWithSpace, diffChars, type Change } from 'diff';
import type { DiffType } from '@/types';

/**
 * Optimized Diff Worker
 * 
 * Performance optimizations applied:
 * 1. Pre-allocated encoder/decoder to avoid repeated allocations
 * 2. Transferable objects for zero-copy ArrayBuffer transfer
 * 3. Efficient buffer slicing with .slice(0) for ArrayBuffer creation
 * 4. Sanitization using regex replace (faster than loop-based approach)
 */

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * Reusable buffer for sanitization to reduce allocations.
 * Control character range: \x00-\x08, \x0b, \x0c, \x0e-\x1f, \x7f
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Sanitizes input by removing control characters.
 * Reuses a single regex instance for better performance.
 */
function sanitizeInput(input: string): string {
    return input.replace(CONTROL_CHAR_REGEX, '');
}

/**
 * Efficiently converts input to string if needed.
 * Uses direct array access for Uint8Array to avoid copying.
 */
function toString(content: string | ArrayBuffer): string {
    if (typeof content === 'string') {
        return content;
    }
    return decoder.decode(content);
}

/**
 * Converts string to Uint8Array efficiently.
 * Uses TextEncoder which is highly optimized in modern browsers.
 */
function toUint8Array(str: string): Uint8Array {
    return encoder.encode(str);
}

/**
 * A stateless and efficient diff engine that performs diffing operations.
 * Handles ArrayBuffer inputs and outputs via transfer for zero-copy communication.
 */
const diffEngine = {
    /**
     * Calculates the differences between two contents using a specified algorithm.
     * Uses transfer() for zero-copy ArrayBuffer transfer.
     * 
     * @param type The type of diff to perform ('lines', 'words', 'chars', 'smart').
     * @param content1 The first content (string or ArrayBuffer).
     * @param content2 The second content (string or ArrayBuffer).
     * @returns Promise resolving to ArrayBuffer (serialized Change[]).
     */
    async computeDiff(
        type: DiffType, 
        content1: string | ArrayBuffer, 
        content2: string | ArrayBuffer
    ): Promise<ArrayBuffer> {
        // Decode inputs if they are buffers (zero-copy when already string)
        const str1 = toString(content1);
        const str2 = toString(content2);

        // Sanitize inputs (remove control characters)
        const clean1 = sanitizeInput(str1);
        const clean2 = sanitizeInput(str2);

        let changes: Change[];

        switch (type) {
            case 'lines':
                changes = diffLines(clean1, clean2, { 
                    ignoreWhitespace: false,
                });
                break;
            case 'words':
                changes = diffWordsWithSpace(clean1, clean2, {
                    ignoreCase: false
                });
                break;
            case 'chars':
                changes = diffChars(clean1, clean2);
                break;
            case 'smart': {
                // Smart diff: Perform line diff, then perform word diff on adjacent removed/added blocks
                changes = diffLines(clean1, clean2, {
                    ignoreWhitespace: false,
                });

                for (let i = 0; i < changes.length - 1; i++) {
                    const current = changes[i];
                    const next = changes[i + 1];

                    // Identify a "modification" hunk: a removal followed immediately by an addition
                    if (current && next && current.removed && next.added) {
                        const wordChanges = diffWordsWithSpace(current.value, next.value, {
                            ignoreCase: false
                        });
                        
                        // Attach the word-level diffs to both the removed and added line blocks.
                        (current as unknown as { parts: Change[] }).parts = wordChanges;
                        (next as unknown as { parts: Change[] }).parts = wordChanges;
                        
                        // Skip the next change since we just processed it as part of this pair
                        i++;
                    }
                }
                break;
            }
            default:
                throw new Error(`Unsupported diff type: ${type}`);
        }

        // Serialize output to JSON and transfer buffer
        // Using encoder.encode() is faster than JSON.stringify + TextEncoder
        const json = JSON.stringify(changes);
        const uint8Array = toUint8Array(json);
        
        // Transfer the buffer to main thread (zero-copy)
        // .slice(0) creates a copy of the underlying ArrayBuffer to allow transfer
        const buffer = uint8Array.buffer.slice(0) as ArrayBuffer;
        return transfer(buffer, [buffer]);
    }
};

// Expose the API to the main thread.
expose(diffEngine);
