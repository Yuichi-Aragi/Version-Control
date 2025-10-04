import type { VersionControlSettings } from '../types';

// Cache compiled regexes for performance with LRU-like cleanup to prevent memory leaks
const regexCache = new Map<string, { regex: RegExp; lastUsed: number }>();
const MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth
const MAX_PATTERN_LENGTH = 10000; // Maximum allowed pattern length
const CLEANUP_INTERVAL = 60000; // Cleanup interval in milliseconds

// Cleanup timer for stale cache entries
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Initializes the cleanup timer for regex cache
 */
function initializeCleanupTimer(): void {
    if (cleanupTimer) return;
    
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        const entries = Array.from(regexCache.entries());
        
        // Remove entries not used in the last 5 minutes
        entries.forEach(([key, value]) => {
            if (now - value.lastUsed > 300000) {
                regexCache.delete(key);
            }
        });
    }, CLEANUP_INTERVAL);
}

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

    // Initialize cleanup timer on first use
    initializeCleanupTimer();

    // Return from cache if available
    const cached = regexCache.get(pattern);
    if (cached) {
        cached.lastUsed = Date.now();
        return cached.regex;
    }

    try {
        // Validate pattern before compilation (basic sanity check)
        if (pattern.length > MAX_PATTERN_LENGTH) {
            console.warn(`Version Control: Pattern too long (${pattern.length} chars), skipped: "${pattern.substring(0, 50)}..."`);
            return null;
        }

        // Additional pattern validation to prevent ReDoS attacks
        if (/(\\[pP]{[^}]*})/.test(pattern)) {
            console.warn('Version Control: Unicode property escapes not supported in pattern');
            return null;
        }

        // Check for potentially catastrophic backtracking
        if (/\(\?=[^)]*\)|\(\?!.*\*.*\)/.test(pattern)) {
            console.warn('Version Control: Potentially dangerous lookahead pattern detected');
            return null;
        }

        // Compile without flags as specified (case-sensitive only)
        const regex = new RegExp(pattern);
        
        // Cache management - LRU-like behavior with timestamp
        if (regexCache.size >= MAX_CACHE_SIZE) {
            // Find and remove the least recently used entry
            let oldestKey: string | null = null;
            let oldestTime = Date.now();
            
            regexCache.forEach((value, key) => {
                if (value.lastUsed < oldestTime) {
                    oldestTime = value.lastUsed;
                    oldestKey = key;
                }
            });
            
            if (oldestKey) {
                regexCache.delete(oldestKey);
            }
        }
        
        regexCache.set(pattern, { regex, lastUsed: Date.now() });
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
 * Validates and sanitizes a file path
 * @param path The path to validate
 * @returns Sanitized path or null if invalid
 */
function validatePath(path: unknown): string | null {
    if (typeof path !== 'string') {
        console.warn(`Version Control: Invalid path type received (expected string, got ${typeof path})`);
        return null;
    }
    
    if (path.trim() === '') {
        console.warn('Version Control: Empty path received');
        return null;
    }

    // Normalize path separators
    let sanitizedPath = path.replace(/\\/g, '/');
    
    // Remove any null bytes
    sanitizedPath = sanitizedPath.replace(/\0/g, '');
    
    // Check for path traversal attempts
    if (sanitizedPath.includes('../') || sanitizedPath.includes('..\\')) {
        console.warn('Version Control: Path traversal attempt detected', { path });
        return null;
    }
    
    // Check for excessively long paths
    if (sanitizedPath.length > 260) { // Windows MAX_PATH limit
        console.warn('Version Control: Path too long', { path: sanitizedPath.substring(0, 50) + '...' });
        return null;
    }
    
    return sanitizedPath;
}

/**
 * Validates the settings object
 * @param settings The settings to validate
 * @returns Validated pathFilters array or null if invalid
 */
function validateSettings(settings: unknown): string[] | null {
    if (!settings || typeof settings !== 'object') {
        console.warn('Version Control: Invalid settings object received');
        return null;
    }

    const settingsObj = settings as Record<string, unknown>;
    
    if (!('pathFilters' in settingsObj)) {
        console.warn('Version Control: Settings missing pathFilters property');
        return null;
    }

    const pathFilters = settingsObj['pathFilters'];
    
    if (!Array.isArray(pathFilters)) {
        console.warn('Version Control: pathFilters is not an array');
        return null;
    }

    // Validate each filter pattern
    const validFilters: string[] = [];
    for (const filter of pathFilters) {
        if (filter === null || filter === undefined) {
            continue;
        }
        
        const filterStr = String(filter);
        if (filterStr.trim() === '') {
            continue;
        }
        
        // Additional validation for filter patterns
        if (filterStr.length > MAX_PATTERN_LENGTH) {
            console.warn('Version Control: Filter pattern too long, skipping', { 
                filter: filterStr.substring(0, 50) + '...' 
            });
            continue;
        }
        
        validFilters.push(filterStr);
    }
    
    return validFilters;
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
    // Validate and sanitize path
    const sanitizedPath = validatePath(path);
    if (sanitizedPath === null) {
        return false; // Fail safe - reject invalid paths
    }

    // Validate settings
    const pathFilters = validateSettings(settings);
    if (pathFilters === null) {
        return true; // Default to allowing when settings are invalid (backward compatible)
    }

    // Early return for no filters (backward compatible behavior)
    if (pathFilters.length === 0) {
        return true; // No filters, so everything is allowed
    }

    // Process filters with maximum error tolerance
    let hasMatch = false;
    try {
        hasMatch = pathFilters.some(pattern => {
            const regex = getRegex(pattern);
            return regex ? regex.test(sanitizedPath) : false;
        });
    } catch (error) {
        // Log any unexpected errors during filter processing
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Version Control: Unexpected error during path filtering', {
            error: errorMessage,
            path: sanitizedPath,
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

/**
 * Cleanup function to be called when the module is unloaded
 */
export function cleanup(): void {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    regexCache.clear();
}
