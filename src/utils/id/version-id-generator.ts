/**
 * Version ID generation utilities
 *
 * @module id-utils/version-id-generator
 */

import type { VersionControlSettings } from '@/types';
import { isVersionControlSettings } from '@/utils/id/types';
import { SANITIZATION_CONFIG, VALIDATION } from '@/utils/id/config';
import { sanitizeId, validateAndSanitizeString } from '@/utils/id/sanitizers';
import { generateSortableTimestamp } from '@/utils/id/timestamp-provider';
import { replacePlaceholders } from '@/utils/id/format-parser';

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
    const timestamp = generateSortableTimestamp(date);

    // Build ID with efficient replacement
    const versionStr = validatedVersionNum.toString();

    // Use index-based replacement with conditional checks
    const replacements: Array<[string, string]> = [
        ['{timestamp}', timestamp],
        ['{version}', versionStr],
        ['{name}', versionName]
    ];

    let id = replacePlaceholders(format, replacements);

    // Clean up empty variables resulting in multiple underscores
    id = id.replace(SANITIZATION_CONFIG.MULTIPLE_UNDERSCORES_REGEX, '_');
    id = id.replace(SANITIZATION_CONFIG.EDGE_UNDERSCORES_REGEX, '');

    // Fallback if the resulting ID is empty after cleanup
    if (!id || id.trim().length === 0) {
        id = `${timestamp}_${versionStr}`;
    }

    return sanitizeId(id);
}
