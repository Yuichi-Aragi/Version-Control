/// <reference lib="webworker" />

import { expose } from 'comlink';
import { diffLines, diffWordsWithSpace, diffChars, diffJson, type Change } from 'diff';
import type { DiffType } from '../types';

/**
 * A stateless and simple diff engine that performs diffing operations.
 * All validation, sanitization, and complex logic is handled by the DiffManager in the main thread.
 * This worker assumes all inputs are valid and sanitized.
 */
const diffEngine = {
    /**
     * Calculates the differences between two strings using a specified algorithm.
     * @param type The type of diff to perform ('lines', 'words', 'chars', 'json').
     * @param content1 The first string for comparison.
     * @param content2 The second string for comparison.
     * @returns An array of Change objects representing the differences.
     * @throws {Error} If the diffing algorithm fails (e.g., invalid JSON).
     */
    computeDiff(type: DiffType, content1: string, content2: string): Change[] {
        switch (type) {
            case 'lines':
                return diffLines(content1, content2, { 
                    newlineIsToken: true,
                    ignoreWhitespace: false,
                });
            case 'words':
                return diffWordsWithSpace(content1, content2, {
                    ignoreCase: false
                });
            case 'chars':
                return diffChars(content1, content2);
            case 'json': {
                // The manager should have already validated that these are valid JSON strings.
                // This parse is for the diffJson function's requirement for objects, not strings.
                const parsed1 = JSON.parse(content1);
                const parsed2 = JSON.parse(content2);
                return diffJson(parsed1, parsed2);
            }
            default:
                // This case should not be reached if DiffManager validates `diffType`.
                // Throwing an error is a safe fallback.
                throw new Error(`Unsupported diff type: ${type}`);
        }
    }
};

// Expose the API to the main thread.
expose(diffEngine);
