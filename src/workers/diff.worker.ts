/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { diffLines, diffWordsWithSpace, diffChars, type Change } from 'diff';
import type { DiffType } from '@/types';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * A stateless and simple diff engine that performs diffing operations.
 * Handles ArrayBuffer inputs and outputs via transfer for zero-copy communication.
 */
const diffEngine = {
    /**
     * Calculates the differences between two contents using a specified algorithm.
     * @param type The type of diff to perform ('lines', 'words', 'chars', 'smart').
     * @param content1 The first content (string or ArrayBuffer).
     * @param content2 The second content (string or ArrayBuffer).
     * @returns Promise resolving to ArrayBuffer (serialized Change[]).
     */
    async computeDiff(type: DiffType, content1: string | ArrayBuffer, content2: string | ArrayBuffer): Promise<ArrayBuffer> {
        // Decode inputs if they are buffers
        const str1 = typeof content1 === 'string' ? content1 : decoder.decode(content1);
        const str2 = typeof content2 === 'string' ? content2 : decoder.decode(content2);

        // Sanitize inputs (remove control characters)
        const clean1 = str1.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const clean2 = str2.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

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
                        (current as any).parts = wordChanges;
                        (next as any).parts = wordChanges;
                        
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
        const json = JSON.stringify(changes);
        const uint8Array = encoder.encode(json);
        // Cast to ArrayBuffer to satisfy TypeScript's Transferable requirement
        const buffer = uint8Array.buffer as ArrayBuffer;
        return transfer(buffer, [buffer]);
    }
};

// Expose the API to the main thread.
expose(diffEngine);
