/**
 * Note ID generation utilities
 *
 * @module id-utils/note-id-generator
 */

import type { TFile } from 'obsidian';
import type { VersionControlSettings } from '@/types';
import { isVersionControlSettings, isTFile, isCryptoAvailable } from '@/utils/id/types';
import { VALIDATION } from '@/utils/id/config';
import { sanitizeId, transformFilePathExtensions, validateAndSanitizeString } from '@/utils/id/sanitizers';
import { generateMillisecondTimestamp } from '@/utils/id/timestamp-provider';
import { replacePlaceholders, hasPlaceholder } from '@/utils/id/format-parser';

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
    const hasTimestampVariable = hasPlaceholder(format, '{timestamp}');
    const timestamp = hasTimestampVariable ? generateMillisecondTimestamp(customTimestamp) : '';

    // Generate UUID only when needed
    const hasUuidVariable = hasPlaceholder(format, '{uuid}');
    let uuid = '';

    if (hasUuidVariable) {
        if (customUuid) {
            uuid = customUuid;
        } else {
            uuid = generateUniqueId();
        }
    }

    // Build ID using efficient string replacement
    const replacements: Array<[string, string]> = [
        ['{path}', transformedPath],
        ['{uuid}', uuid],
        ['{timestamp}', timestamp]
    ];

    const id = replacePlaceholders(format, replacements);

    return sanitizeId(id);
}
