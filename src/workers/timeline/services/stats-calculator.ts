/// <reference lib="webworker" />

import type { TimelineStats } from '@/types';
import type { Change } from '@/workers/timeline/types';
import { isValidNumber } from '@/workers/timeline/utils';

/**
 * Statistics Calculator Service
 *
 * This module calculates statistics from diff changes.
 */

/**
 * Calculates precise statistics from diff changes with early exit optimization.
 *
 * @param changes - The diff changes to analyze
 * @returns Timeline statistics (additions and deletions)
 */
export function calculateStats(changes: Change[]): TimelineStats {
    let additions = 0;
    let deletions = 0;

    for (const change of changes) {
        // Skip undefined counts
        if (!isValidNumber(change.count)) continue;

        if (change.added) {
            additions += change.count;
        } else if (change.removed) {
            deletions += change.count;
        }
        // Unchanged segments are counted in both additions and deletions
    }

    return { additions, deletions };
}