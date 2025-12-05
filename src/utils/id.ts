/**
 * ID generation and sanitization utilities for version control system
 * 
 * @module id-utils
 */
import { v4 as uuidv4 } from 'uuid';
import { TFile } from 'obsidian';

/**
 * Configuration constants for ID sanitization
 */
const SANITIZATION_CONFIG = {
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
 * Validation and error messages
 */
const VALIDATION = {
    ERRORS: {
        FILE_REQUIRED: 'Version Control: File parameter is required and cannot be null or undefined',
        VERSION_NUM_INVALID: 'Version Control: versionNum must be a positive integer',
        CRYPTO_UNAVAILABLE: "Version Control: Global 'crypto' object is not available or malformed. Cannot generate secure unique IDs.",
        CRYPTO_RANDOM_UUID_INVALID: "Version Control: 'crypto.randomUUID' is not a function. Cannot generate secure unique IDs.",
        CRYPTO_INVOCATION_FAILED: "Version Control: Invocation of 'crypto.randomUUID()' failed: ",
        CRYPTO_RESULT_INVALID: "Version Control: 'crypto.randomUUID()' returned invalid or empty result.",
        CRYPTO_FORMAT_INVALID: "Version Control: Generated ID does not conform to UUID v4 format."
    },
    REGEX: {
        UUID_V4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        POSITIVE_INTEGER: /^\d+$/
    }
} as const;

/**
 * Type guard for crypto object
 */
function isCryptoAvailable(cryptoObj: unknown): cryptoObj is Crypto {
    return typeof cryptoObj === 'object' && 
           cryptoObj !== null && 
           'randomUUID' in cryptoObj && 
           typeof (cryptoObj as Crypto).randomUUID === 'function';
}

/**
 * Validates and sanitizes input string
 */
function validateAndSanitizeString(input: unknown, _paramName: string): string {
    if (input === null || input === undefined) {
        return '';
    }
    
    if (typeof input !== 'string') {
        // Attempt to convert non-string inputs
        try {
            return String(input);
        } catch {
            return '';
        }
    }
    
    return input;
}

/**
 * Sanitizes an ID string to be safe for use as a filename and folder name across operating systems.
 * Replaces path separators with underscores and removes invalid characters.
 * 
 * @param id - The raw ID string
 * @returns A sanitized ID string
 * 
 * @remarks
 * This function ensures compatibility across Windows, macOS, and Linux filesystems.
 * It handles:
 * - Control characters and invalid filename characters
 * - Path separator replacement
 * - Reserved filenames
 * - Length limitations
 * - Edge character trimming
 * 
 * @example
 * ```typescript
 * sanitizeId('my/file:name') // Returns 'my_file_name'
 * sanitizeId('CON') // Returns 'unnamed_id' (reserved name)
 * sanitizeId('  test..txt  ') // Returns 'test_txt'
 * ```
 */
export function sanitizeId(id: string): string {
    // Validate and normalize input
    const inputString = validateAndSanitizeString(id, 'id');
    
    if (inputString.length === 0) {
        return '';
    }
    
    let sanitized = inputString;
    
    // Remove control characters (proactive security measure)
    sanitized = sanitized.replace(SANITIZATION_CONFIG.CONTROL_CHARS_REGEX, '');
    
    // Replace invalid filename characters with underscore (path separators included)
    sanitized = sanitized.replace(SANITIZATION_CONFIG.INVALID_FILENAME_CHARS_REGEX, '_');
    
    // Remove leading/trailing problematic characters
    sanitized = sanitized.replace(SANITIZATION_CONFIG.PROBLEMATIC_EDGE_CHARS_REGEX, '');
    
    // Collapse multiple consecutive underscores
    sanitized = sanitized.replace(SANITIZATION_CONFIG.MULTIPLE_UNDERSCORES_REGEX, '_');
    
    // Remove leading/trailing underscores
    sanitized = sanitized.replace(SANITIZATION_CONFIG.EDGE_UNDERSCORES_REGEX, '');
    
    // Enforce maximum length to prevent filesystem issues
    if (sanitized.length > SANITIZATION_CONFIG.MAX_ID_LENGTH) {
        sanitized = sanitized.substring(0, SANITIZATION_CONFIG.MAX_ID_LENGTH);
    }
    
    // Check for reserved filenames (case-insensitive)
    const upperCaseSanitized = sanitized.toUpperCase();
    if (SANITIZATION_CONFIG.RESERVED_NAMES.has(upperCaseSanitized)) {
        return SANITIZATION_CONFIG.DEFAULT_FALLBACK_ID;
    }
    
    // Final validation: ensure non-empty result
    return sanitized.length > 0 ? sanitized : SANITIZATION_CONFIG.DEFAULT_FALLBACK_ID;
}

/**
 * Generates a note ID.
 * 
 * @param _file - The file for which to generate the ID (currently unused)
 * @returns A UUIDv4 string
 */
export function generateNoteId(_file: TFile): string {
    return uuidv4();
}

/**
 * Generates a version ID.
 * 
 * @returns A UUIDv4 string
 */
export function generateVersionId(): string {
    return uuidv4();
}

/**
 * Generates a cryptographically secure unique identifier using the Web Crypto API.
 * 
 * @returns A cryptographically secure UUID v4 string
 * 
 * @throws {Error} If Web Crypto API is unavailable or UUID generation fails
 * 
 * @remarks
 * - Uses crypto.randomUUID() for optimal performance and security
 * - Includes comprehensive validation of crypto API availability
 * - Validates UUID format and structure
 * - Maintains backward compatibility with existing implementations
 * 
 * @example
 * ```typescript
 * generateUniqueId() // Returns '123e4567-e89b-12d3-a456-426614174000'
 * ```
 */
export function generateUniqueId(): string {
    // Proactive validation of global crypto object
    if (typeof globalThis === 'undefined' || 
        !('crypto' in globalThis) || 
        !isCryptoAvailable(globalThis.crypto)) {
        console.error(`[CRITICAL FAILURE] ${VALIDATION.ERRORS.CRYPTO_UNAVAILABLE}`);
        throw new Error(VALIDATION.ERRORS.CRYPTO_UNAVAILABLE);
    }
    
    const cryptoObj = globalThis.crypto as Crypto;
    
    // Validate randomUUID function exists and is callable
    if (typeof cryptoObj.randomUUID !== 'function') {
        console.error(`[CRITICAL FAILURE] ${VALIDATION.ERRORS.CRYPTO_RANDOM_UUID_INVALID}`);
        throw new Error(VALIDATION.ERRORS.CRYPTO_RANDOM_UUID_INVALID);
    }
    
    let generatedId: string;
    
    try {
        // Generate UUID with proper error handling
        generatedId = cryptoObj.randomUUID();
    } catch (innerError) {
        const errorMessage = VALIDATION.ERRORS.CRYPTO_INVOCATION_FAILED + 
            (innerError instanceof Error ? innerError.message : String(innerError));
        console.error(`[CRITICAL FAILURE] ${errorMessage}`);
        throw new Error(errorMessage);
    }
    
    // Post-generation validation
    if (typeof generatedId !== 'string' || generatedId.trim().length === 0) {
        console.error(`[CRITICAL FAILURE] ${VALIDATION.ERRORS.CRYPTO_RESULT_INVALID}`);
        throw new Error(VALIDATION.ERRORS.CRYPTO_RESULT_INVALID);
    }
    
    // Validate UUID v4 format
    if (!VALIDATION.REGEX.UUID_V4.test(generatedId)) {
        console.error(`[CRITICAL FAILURE] ${VALIDATION.ERRORS.CRYPTO_FORMAT_INVALID}`);
        throw new Error(VALIDATION.ERRORS.CRYPTO_FORMAT_INVALID);
    }
    
    // Return validated, cryptographically secure UUID
    return generatedId;
}
