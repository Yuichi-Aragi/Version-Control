/**
 * CONFIGURATION & CONSTANTS
 *
 * Configuration values and constants used throughout the path filter module.
 */

/** Maximum cache size to prevent memory exhaustion */
export const MAX_CACHE_SIZE = 1000;

/** Maximum allowed pattern length for security */
export const MAX_PATTERN_LENGTH = 10000;

/** Maximum path length (Windows MAX_PATH limit) */
export const MAX_PATH_LENGTH = 260;

/** Cache TTL in milliseconds (5 minutes) */
export const CACHE_TTL_MS = 300000;

/** Path traversal patterns for security validation */
export const PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//,        // ../ in Unix-style paths
    /\.\.\\/,        // ..\ in Windows-style paths
    /\0/,            // Null bytes
    /\\\.\./,        // \.. in mixed paths
    /\/\.\.\//,      // /../ in paths
    /\\\\\.\.\\/     // \\..\\ in UNC paths
] as const;

/** Dangerous regex patterns that could cause ReDoS */
export const DANGEROUS_REGEX_PATTERNS = [
    /\(\?=[^)]*\)/,     // Lookahead with quantifiers
    /\(\?!.*\*.*\)/,    // Negative lookahead with wildcards
    /\*\*+/,           // Nested quantifiers
    /\(\?:.*\)\{2,\}/,  // Repeated non-capturing groups
    /\\[pP]\{[^}]*\}/  // Unicode property escapes
] as const;

/** Reserved filenames and paths (Windows/Linux) */
export const RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    '.', '..', '...'
]);
