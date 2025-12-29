/**
 * Reserved filenames on Windows and other systems (case-insensitive)
 * These cannot be used as folder or file names.
 */
export const RESERVED_FILENAMES = Object.freeze([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
] as const);

/**
 * Reserved keys in Obsidian frontmatter that we should not overwrite.
 */
export const RESERVED_FRONTMATTER_KEYS = Object.freeze([
    'tags', 'aliases', 'cssclass', 'publish', 'date', 'title',
    'creation date', 'modification date', 'template'
] as const);

/**
 * Precompiled regex patterns for maximum performance
 */
export const REGEX_PATTERNS = Object.freeze({
    // Characters strictly forbidden in file/folder names across major OSs (Windows, Linux, macOS, Android, iOS)
    // Includes: < > : " / \ | ? * and control characters 0x00-0x1F and 0x7F
    INVALID_FILENAME_CHARS: /[<>:"|?*\\/^\x00-\x1F\x7F]/,

    // Path traversal detection - optimized pattern
    PATH_TRAVERSAL: /(?:^|[\\/])\.\.(?:[\\/]|$)/,

    // Control characters
    CONTROL_CHARS: /[\x00-\x1F\x7F]/,

    // Simple frontmatter key validation
    SAFE_KEY: /^[a-z0-9_-]+$/i,

    // Time format validation
    TIME_FORMAT: /^(\d+):(\d{1,2})$/,

    // Digits only
    DIGITS_ONLY: /^\d+$/,

    // Variable extraction
    VARIABLE_EXTRACTION: /{([^}]+)}/g
} as const);

/**
 * Precomputed Sets for O(1) Lookups
 */
export const RESERVED_FILENAMES_SET = new Set(RESERVED_FILENAMES.map(s => s.toLowerCase()));
export const RESERVED_FRONTMATTER_KEYS_SET = new Set(RESERVED_FRONTMATTER_KEYS.map(s => s.toLowerCase()));
