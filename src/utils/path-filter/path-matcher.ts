/**
 * PATH MATCHING LOGIC
 *
 * Core path matching functionality using compiled regex patterns.
 */

import { compileRegex } from '@/utils/path-filter/regex-compiler';

/**
 * Tests if a path matches any of the given patterns.
 *
 * @param path - Sanitized path to test
 * @param patterns - Array of pattern strings to match against
 * @returns true if any pattern matches, false otherwise
 */
export function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
    for (const pattern of patterns) {
        const regex = compileRegex(pattern);
        if (regex && regex.test(path)) {
            return true;
        }
    }
    return false;
}
