/**
 * Configuration constants for ID generation and sanitization
 *
 * @module id-utils/config
 */

/**
 * Configuration constants for ID sanitization
 */
export const SANITIZATION_CONFIG = {
    /**
     * Control characters (0x00-0x1f and 0x80-0x9f)
     * Includes: null, tab, newline, carriage return, etc.
     */
    CONTROL_CHARS_REGEX: /[\x00-\x1f\x80-\x9f]/g,

    /**
     * Invalid Windows filename characters: < > : " | ? *
     * Also includes backslash and forward slash which are path separators
     */
    INVALID_FILENAME_CHARS_REGEX: /[<>:"|?*\\/]/g,

    /**
     * Leading/trailing dots and spaces that cause filesystem issues
     */
    PROBLEMATIC_EDGE_CHARS_REGEX: /^[.\s]+|[.\s]+$/g,

    /**
     * Multiple consecutive underscores
     */
    MULTIPLE_UNDERSCORES_REGEX: /_{2,}/g,

    /**
     * Leading or trailing underscores
     */
    EDGE_UNDERSCORES_REGEX: /^_|_$/g,

    /**
     * Default fallback ID when sanitization results in empty string
     */
    DEFAULT_FALLBACK_ID: 'unnamed_id',

    /**
     * Maximum length for sanitized IDs to prevent filesystem issues
     */
    MAX_ID_LENGTH: 255,

    /**
     * Reserved filenames across Windows, macOS, and Linux
     */
    RESERVED_NAMES: new Set([
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
        '.', '..'
    ])
} as const;

/**
 * File extension handling constants
 */
export const FILE_EXTENSION_HANDLING = {
    /**
     * File extensions that need to be transformed at the end of paths
     */
    EXTENSIONS_TO_TRANSFORM: new Set(['.md', '.base']),

    /**
     * Mapping of extensions to their transformed versions
     */
    EXTENSION_TRANSFORM_MAP: new Map([
        ['.md', '_md'],
        ['.base', '_base']
    ]),

    /**
     * Regex to match extensions at the end of a string
     * Uses negative lookahead to ensure it's at the end and not part of a larger word
     */
    EXTENSION_AT_END_REGEX: /\.(?:md|base)$/
} as const;

/**
 * Validation and error messages
 */
export const VALIDATION = {
    ERRORS: {
        SETTINGS_REQUIRED: 'Version Control: Settings parameter is required and cannot be null or undefined',
        FILE_REQUIRED: 'Version Control: File parameter is required and cannot be null or undefined',
        VERSION_NUM_INVALID: 'Version Control: versionNum must be a positive integer',
        CRYPTO_UNAVAILABLE: "Version Control: Global 'crypto' object is not available or malformed. Cannot generate secure unique IDs.",
        CRYPTO_RANDOM_UUID_INVALID: "Version Control: 'crypto.randomUUID' is not a function. Cannot generate secure unique IDs.",
        CRYPTO_INVOCATION_FAILED: "Version Control: Invocation of 'crypto.randomUUID()' failed: ",
        CRYPTO_RESULT_INVALID: "Version Control: 'crypto.randomUUID()' returned invalid or empty result.",
        CRYPTO_FORMAT_INVALID: "Version Control: Generated ID does not conform to UUID v4 format."
    },
    REGEX: {
        // Strict validation regex with anchors
        UUID_V4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        // Extraction regex without anchors
        UUID_V4_EXTRACTION: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
        POSITIVE_INTEGER: /^\d+$/,
        // Matches a 13-digit timestamp (milliseconds) or 10-digit (seconds), surrounded by common delimiters or string boundaries
        TIMESTAMP: /(?:^|[_.\- ])([0-9]{13}|[0-9]{10})(?:[_.\- ]|$)/
    }
} as const;
