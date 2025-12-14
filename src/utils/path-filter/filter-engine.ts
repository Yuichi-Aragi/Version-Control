/**
 * CORE FILTERING ENGINE
 *
 * Main filtering logic with comprehensive validation and error handling.
 */

import type { PathFilterSettings } from '@/utils/path-filter/types';
import { validatePath, validateSettings } from '@/utils/path-filter/validation';
import { matchesAnyPattern } from '@/utils/path-filter/path-matcher';

/**
 * Checks if a given file path should be processed based on the plugin's
 * blacklist settings.
 *
 * @param path - The full, vault-relative path of the file
 * @param settings - The current global plugin settings with required properties
 * @returns `true` if the path is allowed, `false` otherwise
 *
 * @remarks
 * - Always returns boolean for maximum resilience (never throws)
 * - Comprehensive input validation and sanitization
 * - Fail-safe defaults for invalid inputs
 * - Performance optimized with caching
 */
export function isPathAllowed(
    path: unknown,
    settings: PathFilterSettings
): boolean {
    // Phase 1: Input validation
    const pathValidation = validatePath(path);
    if (!pathValidation.isValid) {
        // Fail-safe: reject invalid paths
        console.debug('Version Control: Path validation failed', {
            error: pathValidation.error,
            sanitized: pathValidation.sanitized
        });
        return false;
    }

    const sanitizedPath = pathValidation.value!;

    // Phase 2: Settings validation
    const settingsValidation = validateSettings(settings);
    if (!settingsValidation.isValid) {
        // Backward compatibility: allow all when settings are invalid
        console.debug('Version Control: Settings validation failed, defaulting to allow-all', {
            error: settingsValidation.error
        });
        return true;
    }

    const pathFilters = settingsValidation.value!;

    // Phase 3: Early return for no filters
    if (pathFilters.length === 0) {
        return true;
    }

    // Phase 4: Filter processing with error boundaries
    try {
        const hasMatch = matchesAnyPattern(sanitizedPath, pathFilters);

        // Apply blacklist logic: match means blocked
        return !hasMatch;

    } catch (error) {
        // Ultimate safety net - log and return conservative default
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error('Version Control: Critical error in path filtering', {
            error: errorMessage,
            path: sanitizedPath,
            filterCount: pathFilters.length,
            timestamp: new Date().toISOString()
        });

        // Fail-safe: block when uncertain
        return false;
    }
}
