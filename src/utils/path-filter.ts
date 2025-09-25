import type { VersionControlSettings } from '../types';

// Cache compiled regexes for performance with LRU-like cleanup to prevent memory leaks
const regexCache = new Map<string, RegExp>();
const MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth

/**
 * Safely compiles and caches regex patterns with strict validation and error handling.
 * @param pattern The regex pattern string to compile
 * @returns Compiled RegExp if valid, null otherwise
 */
function getRegex(pattern: string): RegExp | null {
    // Strict input validation
    if (typeof pattern !== 'string') {
        console.warn(`Version Control: Invalid pattern type received (expected string, got ${typeof pattern})`);
        return null;
    }
    
    if (pattern.trim() === '') {
        console.warn('Version Control: Empty pattern skipped');
        return null;
    }

    // Return from cache if available
    if (regexCache.has(pattern)) {
        return regexCache.get(pattern)!;
    }

    try {
        // Validate pattern before compilation (basic sanity check)
        if (pattern.length > 10000) { // Prevent extremely long patterns
            console.warn(`Version Control: Pattern too long (${pattern.length} chars), skipped: "${pattern.substring(0, 50)}..."`);
            return null;
        }

        // Compile without flags as specified (case-sensitive only)
        const regex = new RegExp(pattern);
        
        // Cache management - LRU-like behavior
        if (regexCache.size >= MAX_CACHE_SIZE) {
            // Remove the first inserted item (oldest)
            const firstKey = regexCache.keys().next().value;
            if (firstKey !== undefined) {
                regexCache.delete(firstKey);
            }
        }
        
        regexCache.set(pattern, regex);
        return regex;
    } catch (error) {
        // Defensive error handling with detailed logging
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Version Control: Invalid regex pattern skipped: "${pattern}"`, {
            error: errorMessage,
            patternLength: pattern.length,
            timestamp: new Date().toISOString()
        });
        return null;
    }
}

/**
 * Checks if a given file path should be processed based on the plugin's
 * blacklist settings.
 * 
 * @param path - The full, vault-relative path of the file (must be a non-empty string)
 * @param settings - The current global plugin settings with required properties
 * @returns `true` if the path is allowed, `false` otherwise
 * @throws Will not throw - always returns boolean for maximum resilience
 */
export function isPathAllowed(
    path: unknown, 
    settings: Pick<VersionControlSettings, 'pathFilters'>
): boolean {
    // Strict type checking and validation for path parameter
    if (typeof path !== 'string') {
        console.warn(`Version Control: Invalid path type received (expected string, got ${typeof path})`);
        return false; // Fail safe - reject invalid paths
    }
    
    if (path.trim() === '') {
        console.warn('Version Control: Empty path received');
        return false; // Empty paths are not allowed
    }

    // Defensive validation of settings object
    if (!settings || typeof settings !== 'object') {
        console.warn('Version Control: Invalid settings object received');
        return true; // Default to allowing when settings are invalid (backward compatible)
    }

    // Extract settings with fallbacks for maximum resilience
    const pathFilters = Array.isArray(settings.pathFilters) ? settings.pathFilters : [];

    // Early return for no filters (backward compatible behavior)
    if (!pathFilters || pathFilters.length === 0) {
        return true; // No filters, so everything is allowed
    }

    // Process filters with maximum error tolerance
    let hasMatch = false;
    try {
        hasMatch = pathFilters.some(pattern => {
            // Skip invalid patterns
            if (pattern === null || pattern === undefined) {
                return false;
            }
            
            // Convert to string if not already (tolerate minor inconsistencies)
            const patternStr = String(pattern);
            if (patternStr.trim() === '') {
                return false;
            }
            
            const regex = getRegex(patternStr);
            return regex ? regex.test(path) : false;
        });
    } catch (error) {
        // Log any unexpected errors during filter processing
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Version Control: Unexpected error during path filtering', {
            error: errorMessage,
            path,
            filterCount: pathFilters.length,
            timestamp: new Date().toISOString()
        });
        // Fail safe - in case of errors, default to no match
        hasMatch = false;
    }

    // Apply blacklist logic
    try {
        return !hasMatch; // In blacklist mode, a match means it's blocked
    } catch (error) {
        // Final safety net - log and return conservative default
        console.error('Version Control: Critical error in final filter logic', error);
        return false; // Fail safe - block when in doubt
    }
}
