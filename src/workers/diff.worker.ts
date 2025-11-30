/// <reference lib="webworker" />

import { expose } from 'comlink';
import { diffLines, diffWordsWithSpace, diffChars, type Change } from 'diff';
import type { DiffType } from '../types';

/**
 * A stateless and simple diff engine that performs diffing operations.
 * All validation, sanitization, and complex logic is handled by the DiffManager in the main thread.
 * This worker assumes all inputs are valid and sanitized.
 */
const diffEngine = {
    /**
     * Calculates the differences between two strings using a specified algorithm.
     * @param type The type of diff to perform ('lines', 'words', 'chars', 'smart').
     * @param content1 The first string for comparison.
     * @param content2 The second string for comparison.
     * @returns An array of Change objects representing the differences.
     * @throws {Error} If the diffing algorithm fails.
     */
    computeDiff(type: DiffType, content1: string, content2: string): Change[] {
        switch (type) {
            case 'lines':
                return diffLines(content1, content2, { 
                    ignoreWhitespace: false,
                });
            case 'words':
                return diffWordsWithSpace(content1, content2, {
                    ignoreCase: false
                });
            case 'chars':
                return diffChars(content1, content2);
            case 'smart': {
                // Smart diff: Perform line diff, then perform word diff on adjacent removed/added blocks
                const changes = diffLines(content1, content2, {
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
                        // The UI will use these to highlight specific words within the lines.
                        // We cast to any to attach the 'parts' property which is defined in our extended Change schema.
                        (current as any).parts = wordChanges;
                        (next as any).parts = wordChanges;
                        
                        // Skip the next change since we just processed it as part of this pair
                        i++;
                    }
                }
                return changes;
            }
            default:
                throw new Error(`Unsupported diff type: ${type}`);
        }
    }
};

// Expose the API to the main thread.
expose(diffEngine);
