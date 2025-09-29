/// <reference lib="webworker" />

import { expose } from 'comlink';
import { diffLines, diffWordsWithSpace, diffChars, diffJson, type Change } from 'diff';
import { isString } from 'lodash-es';
import type { DiffType } from '../types';

/**
 * Defines the API that will be exposed to the main thread via Comlink.
 * This object contains the computationally intensive tasks to be offloaded.
 */
const diffEngine = {
    /**
     * Calculates the differences between two strings using a specified algorithm.
     * This method is designed to be executed in a web worker context.
     * @param type The type of diff to perform ('lines', 'words', 'chars', 'json').
     * @param content1 The first string for comparison.
     * @param content2 The second string for comparison.
     * @returns An array of Change objects representing the differences.
     * @throws {Error} If inputs are not valid strings or if the diffing algorithm fails.
     */
    computeDiff(type: DiffType, content1: string, content2: string): Change[] {
        // Robust validation at the worker boundary is critical.
        if (!isString(content1)) {
            throw new Error('Invalid input: content1 must be a string.');
        }
        if (!isString(content2)) {
            throw new Error('Invalid input: content2 must be a string.');
        }

        try {
            let changes: Change[];

            switch (type) {
                case 'lines':
                    changes = diffLines(content1, content2, { newlineIsToken: true });
                    break;
                case 'words':
                    changes = diffWordsWithSpace(content1, content2);
                    break;
                case 'chars':
                    changes = diffChars(content1, content2);
                    break;
                case 'json':
                    // FIX: The `diffJson` function does not accept the `newlineIsToken` option.
                    // It has its own specific options, but for this use case, no options are needed.
                    changes = diffJson(content1, content2);
                    break;
                default:
                    throw new Error(`Unsupported diff type: ${type}`);
            }

            // Post-condition validation ensures the diff library behaves as expected.
            if (!Array.isArray(changes)) {
                // This case should be rare but protects against unexpected library behavior.
                throw new Error('Diff algorithm returned an invalid result format.');
            }

            return changes;
        } catch (diffError) {
            // Wrap any error from the diff library for better context on the main thread.
            const message = diffError instanceof Error ? diffError.message : String(diffError);
            throw new Error(`Diff calculation failed: ${message}`);
        }
    }
};

// Expose the API to the main thread. Comlink handles all the communication boilerplate.
expose(diffEngine);
