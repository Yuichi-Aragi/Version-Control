/**
 * VERSION CONTROL PATH FILTER MODULE
 * 
 * Optimized, hardened, and production-ready implementation
 * with comprehensive validation, security, and performance optimizations
 */

// ================================
// TYPES & INTERFACES
// ================================



/** Cache entry for compiled regex patterns */
interface RegexCacheEntry {
    readonly regex: RegExp;
    readonly timestamp: number;
    readonly hitCount: number;
}

/** Performance metrics for monitoring */
interface PerformanceMetrics {
    cacheHits: number;
    cacheMisses: number;
    compilations: number;
    validationFailures: number;
    totalProcessed: number;
}

/** Comprehensive validation result */
interface ValidationResult<T> {
    readonly isValid: boolean;
    readonly value?: T;
    readonly error?: string;
    readonly sanitized?: string;
}

// ================================
// CONSTANTS & CONFIGURATION
// ================================

/** Maximum cache size to prevent memory exhaustion */
const MAX_CACHE_SIZE = 1000;

/** Maximum allowed pattern length for security */
const MAX_PATTERN_LENGTH = 10000;

/** Maximum path length (Windows MAX_PATH limit) */
const MAX_PATH_LENGTH = 260;

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 300000;

/** Path traversal patterns for security validation */
const PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//,        // ../ in Unix-style paths
    /\.\.\\/,        // ..\ in Windows-style paths
    /\0/,            // Null bytes
    /\\\.\./,        // \.. in mixed paths
    /\/\.\.\//,      // /../ in paths
    /\\\\\.\.\\/     // \\..\\ in UNC paths
] as const;

/** Dangerous regex patterns that could cause ReDoS */
const DANGEROUS_REGEX_PATTERNS = [
    /\(\?=[^)]*\)/,     // Lookahead with quantifiers
    /\(\?!.*\*.*\)/,    // Negative lookahead with wildcards
    /\*\*+/,           // Nested quantifiers
    /\(\?:.*\)\{2,\}/,  // Repeated non-capturing groups
    /\\[pP]\{[^}]*\}/  // Unicode property escapes
] as const;

/** Reserved filenames and paths (Windows/Linux) */
const RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    '.', '..', '...'
]);

// ================================
// CACHE MANAGEMENT
// ================================

/** LRU cache for compiled regex patterns with TTL and size limits */
class RegexCache {
    private cache = new Map<string, RegexCacheEntry>();
    private metrics: PerformanceMetrics = {
        cacheHits: 0,
        cacheMisses: 0,
        compilations: 0,
        validationFailures: 0,
        totalProcessed: 0
    };

    /** Get compiled regex with LRU update */
    get(pattern: string): RegExp | null {
        this.metrics.totalProcessed++;
        
        const entry = this.cache.get(pattern);
        if (entry) {
            this.metrics.cacheHits++;
            // Update LRU order by deleting and re-inserting
            this.cache.delete(pattern);
            this.cache.set(pattern, {
                ...entry,
                timestamp: Date.now(),
                hitCount: entry.hitCount + 1
            });
            return entry.regex;
        }
        
        this.metrics.cacheMisses++;
        return null;
    }

    /** Store compiled regex with cache management */
    set(pattern: string, regex: RegExp): void {
        this.metrics.compilations++;
        
        // Clean up expired entries before adding new one
        this.cleanupExpired();
        
        // Enforce maximum cache size
        if (this.cache.size >= MAX_CACHE_SIZE) {
            this.evictLRU();
        }
        
        this.cache.set(pattern, {
            regex,
            timestamp: Date.now(),
            hitCount: 1
        });
    }

    /** Remove expired cache entries (older than TTL) */
    private cleanupExpired(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];
        
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > CACHE_TTL_MS) {
                expiredKeys.push(key);
            }
        }
        
        expiredKeys.forEach(key => this.cache.delete(key));
    }

    /** Evict least recently used entry */
    private evictLRU(): void {
        if (this.cache.size === 0) return;
        
        let oldestKey: string | null = null;
        let oldestTime = Date.now();
        
        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /** Clear all cache entries */
    clear(): void {
        this.cache.clear();
        this.resetMetrics();
    }

    /** Get current cache statistics */
    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const totalAccesses = this.metrics.cacheHits + this.metrics.cacheMisses;
        const hitRate = totalAccesses > 0 
            ? (this.metrics.cacheHits / totalAccesses) * 100 
            : 0;
            
        return {
            size: this.cache.size,
            hits: this.metrics.cacheHits,
            misses: this.metrics.cacheMisses,
            hitRate: parseFloat(hitRate.toFixed(2))
        };
    }

    /** Reset performance metrics */
    private resetMetrics(): void {
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            compilations: 0,
            validationFailures: 0,
            totalProcessed: 0
        };
    }
}

// Global regex cache instance
const regexCache = new RegexCache();

// ================================
// VALIDATION UTILITIES
// ================================

/** Comprehensive pattern validation with security checks */
function validatePattern(pattern: unknown): ValidationResult<string> {
    // Type validation
    if (typeof pattern !== 'string') {
        return {
            isValid: false,
            error: `Invalid pattern type: expected string, got ${typeof pattern}`
        };
    }

    const trimmed = pattern.trim();
    
    // Empty pattern validation
    if (trimmed.length === 0) {
        return {
            isValid: false,
            error: 'Pattern cannot be empty or whitespace only'
        };
    }

    // Length validation for security
    if (trimmed.length > MAX_PATTERN_LENGTH) {
        return {
            isValid: false,
            error: `Pattern too long: ${trimmed.length} characters (max ${MAX_PATTERN_LENGTH})`,
            sanitized: trimmed.substring(0, 100) + '...'
        };
    }

    // Dangerous pattern detection
    for (const dangerousPattern of DANGEROUS_REGEX_PATTERNS) {
        if (dangerousPattern.test(trimmed)) {
            return {
                isValid: false,
                error: 'Pattern contains potentially dangerous regex constructs',
                sanitized: trimmed
            };
        }
    }

    return {
        isValid: true,
        value: trimmed,
        sanitized: trimmed
    };
}

/** Comprehensive path validation with security hardening */
function validatePath(path: unknown): ValidationResult<string> {
    // Type validation
    if (typeof path !== 'string') {
        return {
            isValid: false,
            error: `Invalid path type: expected string, got ${typeof path}`
        };
    }

    const trimmed = path.trim();
    
    // Empty path validation
    if (trimmed.length === 0) {
        return {
            isValid: false,
            error: 'Path cannot be empty or whitespace only'
        };
    }

    // Length validation
    if (trimmed.length > MAX_PATH_LENGTH) {
        return {
            isValid: false,
            error: `Path too long: ${trimmed.length} characters (max ${MAX_PATH_LENGTH})`,
            sanitized: trimmed.substring(0, 100) + '...'
        };
    }

    // Security: Path traversal detection
    for (const traversalPattern of PATH_TRAVERSAL_PATTERNS) {
        if (traversalPattern.test(trimmed)) {
            return {
                isValid: false,
                error: 'Path contains traversal patterns',
                sanitized: trimmed.replace(/\0/g, '').replace(/[\\/]/g, '/')
            };
        }
    }

    // Normalize path separators
    let sanitized = trimmed.replace(/\\/g, '/');
    
    // Remove any remaining null bytes
    sanitized = sanitized.replace(/\0/g, '');
    
    // Check for reserved names (case-insensitive)
    const segments = sanitized.split('/');
    for (const segment of segments) {
        const upperSegment = segment.toUpperCase();
        if (RESERVED_NAMES.has(upperSegment)) {
            return {
                isValid: false,
                error: `Path contains reserved name: ${segment}`,
                sanitized
            };
        }
    }

    return {
        isValid: true,
        value: sanitized,
        sanitized
    };
}

/** Settings validation with comprehensive type checking */
function validateSettings(settings: unknown): ValidationResult<readonly string[]> {
    // Null/undefined check
    if (settings == null) {
        return {
            isValid: false,
            error: 'Settings object is null or undefined'
        };
    }

    // Type check
    if (typeof settings !== 'object' || Array.isArray(settings)) {
        return {
            isValid: false,
            error: `Settings must be an object, got ${typeof settings}`
        };
    }

    const settingsObj = settings as Record<string, unknown>;
    
    // Check for required pathFilters property
    if (!('pathFilters' in settingsObj)) {
        return {
            isValid: false,
            error: 'Settings missing required property: pathFilters'
        };
    }

    const pathFilters = settingsObj['pathFilters'];
    
    // Type check for pathFilters
    if (!Array.isArray(pathFilters)) {
        return {
            isValid: false,
            error: `pathFilters must be an array, got ${typeof pathFilters}`
        };
    }

    // Validate each filter
    const validFilters: string[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < pathFilters.length; i++) {
        const filter = pathFilters[i];
        
        // Skip null/undefined entries
        if (filter == null) {
            continue;
        }
        
        const validation = validatePattern(filter);
        if (validation.isValid && validation.value) {
            validFilters.push(validation.value);
        } else if (validation.error) {
            errors.push(`Filter at index ${i}: ${validation.error}`);
        }
    }

    if (errors.length > 0 && validFilters.length === 0) {
        return {
            isValid: false,
            error: `All filters invalid: ${errors.join('; ')}`
        };
    }

    return {
        isValid: true,
        value: Object.freeze([...validFilters]) // Return immutable array
    };
}

// ================================
// REGEX COMPILATION
// ================================

/** Safely compile and cache regex pattern with comprehensive error handling */
function compileRegex(pattern: string): RegExp | null {
    // Validate pattern first
    const patternValidation = validatePattern(pattern);
    if (!patternValidation.isValid) {
        console.warn('Version Control: Pattern validation failed:', {
            pattern: patternValidation.sanitized || pattern.substring(0, 50),
            error: patternValidation.error
        });
        return null;
    }

    const validatedPattern = patternValidation.value!;
    
    // Check cache first
    const cachedRegex = regexCache.get(validatedPattern);
    if (cachedRegex) {
        return cachedRegex;
    }

    try {
        // Attempt compilation
        const regex = new RegExp(validatedPattern);
        
        // Test compilation with safe input to catch runtime errors early
        const testInput = 'test-string-for-validation';
        regex.test(testInput);
        
        // Store in cache
        regexCache.set(validatedPattern, regex);
        
        return regex;
    } catch (error) {
        // Comprehensive error handling with structured logging
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        
        console.warn('Version Control: Regex compilation failed:', {
            pattern: validatedPattern.substring(0, 100),
            patternLength: validatedPattern.length,
            errorType: errorName,
            errorMessage,
            timestamp: new Date().toISOString()
        });
        
        return null;
    }
}

// ================================
// MAIN FUNCTIONALITY
// ================================

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
    settings: { pathFilters?: unknown }
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
        let hasMatch = false;
        
        // Optimized iteration with early exit
        for (const pattern of pathFilters) {
            const regex = compileRegex(pattern);
            if (regex && regex.test(sanitizedPath)) {
                hasMatch = true;
                break; // Early exit on first match
            }
        }
        
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

// ================================
// PUBLIC UTILITIES
// ================================

/**
 * Cleanup function to be called when the module is unloaded.
 * Releases all cached resources and resets internal state.
 */
export function cleanup(): void {
    regexCache.clear();
}

/**
 * Get cache statistics for monitoring and debugging.
 * 
 * @returns Current cache statistics including size, hits, misses, and hit rate
 */
export function getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    return regexCache.getStats();
}

/**
 * Force cache invalidation and cleanup.
 * Useful for testing or when patterns need to be recompiled.
 */
export function invalidateCache(): void {
    regexCache.clear();
}

/**
 * Validate and sanitize a single pattern without caching.
 * Useful for testing pattern validity before adding to settings.
 * 
 * @param pattern - Pattern to validate
 * @returns Validation result with sanitized pattern if valid
 */
export function validateSinglePattern(pattern: unknown): ValidationResult<string> {
    return validatePattern(pattern);
}

/**
 * Validate and sanitize a single path.
 * Useful for testing path validity before processing.
 * 
 * @param path - Path to validate
 * @returns Validation result with sanitized path if valid
 */
export function validateSinglePath(path: unknown): ValidationResult<string> {
    return validatePath(path);
}
