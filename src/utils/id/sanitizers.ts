/**
 * Sanitization utilities for filenames and IDs
 *
 * @module id-utils/sanitizers
 */

import { isNil } from 'es-toolkit';
import { SANITIZATION_CONFIG, FILE_EXTENSION_HANDLING, VALIDATION } from '@/utils/id/config';

/**
 * Validates and sanitizes input string
 */
export function validateAndSanitizeString(input: unknown, _paramName: string): string {
    if (isNil(input)) {
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
