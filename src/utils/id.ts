/**
 * ID generation and sanitization utilities for version control system
 * 
 * @module id-utils
 */

import { TFile } from 'obsidian';
import type { VersionControlSettings } from '../types';

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
 * File extension handling constants
 */
const FILE_EXTENSION_HANDLING = {
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
const VALIDATION = {
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

/**
 * Type guard for VersionControlSettings
 */
function isVersionControlSettings(settings: unknown): settings is VersionControlSettings {
    return settings !== null && 
           typeof settings === 'object' && 
           (settings as VersionControlSettings).noteIdFormat !== undefined;
}

/**
 * Type guard for TFile
 */
function isTFile(file: unknown): file is TFile {
    return file !== null && 
           typeof file === 'object' && 
           typeof (file as TFile).path === 'string' &&
           typeof (file as TFile).basename === 'string';
}

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
 * Validates and normalizes version number
 */
function validateVersionNumber(versionNum: unknown): number {
    if (typeof versionNum !== 'number' || !Number.isInteger(versionNum) || versionNum < 1) {
        throw new TypeError(VALIDATION.ERRORS.VERSION_NUM_INVALID);
    }
    return versionNum;
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
 * Transforms file extensions at the end of a path string according to requirements
 * Only transforms .md and .base extensions when they appear at the very end of the path
 * 
 * @param path - The file path to transform
 * @returns Transformed path with extensions replaced
 * 
 * @remarks
 * This function only affects the path used for ID generation, not the actual file path.
 * It ensures that .md becomes _md and .base becomes _base at the end of the path.
 * Does not affect the basename or any other parts of the path.
 * 
 * @example
 * ```typescript
 * transformFilePathExtensions('folder/note.md') // Returns 'folder/note_md'
 * transformFilePathExtensions('folder/note.base') // Returns 'folder/note_base'
 * transformFilePathExtensions('folder/note.md.bak') // Returns 'folder/note.md.bak' (not at end)
 * transformFilePathExtensions('folder/.md/file.txt') // Returns 'folder/.md/file.txt' (not at end)
 * ```
 */
export function transformFilePathExtensions(path: string): string {
    if (typeof path !== 'string' || path.length === 0) {
        return path;
    }
    
    // Check if the path ends with any of the extensions we need to transform
    for (const [extension, replacement] of FILE_EXTENSION_HANDLING.EXTENSION_TRANSFORM_MAP) {
        if (path.endsWith(extension)) {
            // Ensure we only replace when it's exactly at the end (not part of a larger extension)
            // This prevents replacing .md in the middle of a longer extension like .md.bak
            const beforeExtension = path.slice(0, -extension.length);
            
            // Check that what we're removing is exactly the extension (no additional characters after)
            // This is already ensured by endsWith, but we're being explicit
            return beforeExtension + replacement;
        }
    }
    
    return path;
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
 * Extracts a UUID v4 from a given ID string if present.
 * Useful for preserving UUIDs when regenerating IDs (e.g., during renames).
 * 
 * @param id - The ID string to search
 * @returns The found UUID string or null if not found
 */
export function extractUuidFromId(id: string): string | null {
    if (!id || typeof id !== 'string') return null;
    
    const match = id.match(VALIDATION.REGEX.UUID_V4_EXTRACTION);
    return match ? match[0] : null;
}

/**
 * Extracts a timestamp from a given ID string if present.
 * Looks for 13-digit (ms) or 10-digit (sec) numbers surrounded by delimiters.
 * 
 * @param id - The ID string to search
 * @returns The found timestamp string or null if not found
 */
export function extractTimestampFromId(id: string): string | null {
    if (!id || typeof id !== 'string') return null;

    const match = id.match(VALIDATION.REGEX.TIMESTAMP);
    // match[1] contains the captured digits
    return match ? (match[1] || null) : null;
}

/**
 * Generates a note ID based on the configured format and file properties.
 * 
 * @param settings - The plugin settings containing the noteIdFormat
 * @param file - The file for which to generate the ID
 * @param customTimestamp - Optional timestamp to use instead of current time (useful for preserving timestamps during renames)
 * @param customUuid - Optional UUID to use instead of generating a new one (useful for preserving UUIDs during renames)
 * @returns A sanitized note ID
 * 
 * @throws {TypeError} If settings or file parameters are invalid
 * 
 * @remarks
 * Supported format variables:
 * - {uuid}: A cryptographically secure random UUID
 * - {path}: Full file path (with .md/.base extensions transformed at the end)
 * - {timestamp}: Current timestamp in milliseconds (or customTimestamp if provided)
 * 
 * Note: File path extensions (.md/.base) are transformed to _md/_base at the end of the path
 * only when used for the {path} variable.
 * 
 * Special handling for .base files:
 * If the file extension is 'base', the format is forced to '{path}' regardless of settings.
 * This ensures .base files always use a path-based ID structure (transformed to _base).
 * 
 * @example
 * ```typescript
 * generateNoteId(settings, file) // Returns 'folder_note_md_1640995200000'
 * ```
 */
export function generateNoteId(settings: VersionControlSettings, file: TFile, customTimestamp?: string | number, customUuid?: string | null): string {
    // Defensive parameter validation
    if (!isVersionControlSettings(settings)) {
        throw new TypeError(VALIDATION.ERRORS.SETTINGS_REQUIRED);
    }
    
    if (!isTFile(file)) {
        throw new TypeError(VALIDATION.ERRORS.FILE_REQUIRED);
    }
    
    // Safe access with defaults
    let format = typeof settings.noteIdFormat === 'string' && settings.noteIdFormat.trim().length > 0
        ? settings.noteIdFormat
        : '{uuid}';

    // Override format for .base files to ensure path-based ID
    // This ignores the user's configured format for these specific files
    if (file.extension === 'base') {
        format = '{path}';
    }
    
    // Validate file properties
    const filePath = validateAndSanitizeString(file.path, 'file.path');
    
    // Apply extension transformation to the file path (only for the {path} variable)
    // This ensures .md and .base at the end of the path become _md and _base
    const transformedPath = transformFilePathExtensions(filePath);
    
    // Generate timestamp only when needed for performance
    const hasTimestampVariable = format.includes('{timestamp}');
    let timestamp = '';
    
    if (hasTimestampVariable) {
        if (customTimestamp !== undefined && customTimestamp !== null) {
            timestamp = String(customTimestamp);
        } else {
            timestamp = Date.now().toString();
        }
    }

    // Generate UUID only when needed
    const hasUuidVariable = format.includes('{uuid}');
    let uuid = '';

    if (hasUuidVariable) {
        if (customUuid) {
            uuid = customUuid;
        } else {
            uuid = generateUniqueId();
        }
    }
    
    // Build ID using efficient string replacement
    let id = format;
    
    // Use index-based replacement for better performance than sequential replace
    const replacements: Array<[string, string]> = [
        ['{path}', transformedPath],
        ['{uuid}', uuid],
        ['{timestamp}', timestamp]
    ];
    
    for (const [placeholder, value] of replacements) {
        if (id.includes(placeholder)) {
            id = id.split(placeholder).join(value);
        }
    }
    
    return sanitizeId(id);
}

/**
 * Generates a version ID based on the configured format and version properties.
 * 
 * @param settings - The plugin settings containing the versionIdFormat
 * @param versionNum - The sequential version number (must be positive integer)
 * @param name - Optional name given to the version
 * @param originalDate - Optional original date to preserve timestamp during renames
 * @returns A sanitized version ID
 * 
 * @throws {TypeError} If settings parameter is invalid or versionNum is not a positive integer
 * 
 * @remarks
 * Supported format variables:
 * - {timestamp}: Sortable timestamp (YYYYMMDDHHmmss)
 * - {version}: Version number
 * - {name}: Optional version name
 * 
 * Note: Does NOT apply file extension transformation to any inputs.
 * 
 * @example
 * ```typescript
 * generateVersionId(settings, 5, 'initial') // Returns '20241225120000_5_initial'
 * ```
 */
export function generateVersionId(settings: VersionControlSettings, versionNum: number, name?: string, originalDate?: Date): string {
    // Defensive parameter validation
    if (!isVersionControlSettings(settings)) {
        throw new TypeError(VALIDATION.ERRORS.SETTINGS_REQUIRED);
    }
    
    const validatedVersionNum = validateVersionNumber(versionNum);
    const versionName = validateAndSanitizeString(name, 'name');
    
    // Safe access with defaults
    const format = typeof settings.versionIdFormat === 'string' && settings.versionIdFormat.trim().length > 0
        ? settings.versionIdFormat
        : '{timestamp}_{version}';
    
    // Generate sortable timestamp: YYYYMMDDHHmmss (optimized for sorting)
    const date = originalDate || new Date();
    const timestamp = date.getFullYear().toString().padStart(4, '0') +
                     (date.getMonth() + 1).toString().padStart(2, '0') +
                     date.getDate().toString().padStart(2, '0') +
                     date.getHours().toString().padStart(2, '0') +
                     date.getMinutes().toString().padStart(2, '0') +
                     date.getSeconds().toString().padStart(2, '0');
    
    // Build ID with efficient replacement
    let id = format;
    const versionStr = validatedVersionNum.toString();
    
    // Use index-based replacement with conditional checks
    const replacements: Array<[string, string]> = [
        ['{timestamp}', timestamp],
        ['{version}', versionStr],
        ['{name}', versionName]
    ];
    
    for (const [placeholder, value] of replacements) {
        if (id.includes(placeholder)) {
            id = id.split(placeholder).join(value);
        }
    }
    
    // Clean up empty variables resulting in multiple underscores
    id = id.replace(SANITIZATION_CONFIG.MULTIPLE_UNDERSCORES_REGEX, '_');
    id = id.replace(SANITIZATION_CONFIG.EDGE_UNDERSCORES_REGEX, '');
    
    // Fallback if the resulting ID is empty after cleanup
    if (!id || id.trim().length === 0) {
        id = `${timestamp}_${versionStr}`;
    }
    
    return sanitizeId(id);
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
