/**
 * Format string parsing and variable replacement utilities
 *
 * @module id-utils/format-parser
 */

/**
 * Replaces placeholders in a format string with provided values
 *
 * @param format - The format string containing placeholders
 * @param replacements - Array of [placeholder, value] tuples
 * @returns Format string with placeholders replaced
 *
 * @remarks
 * Uses efficient split-join approach for better performance than sequential replace
 *
 * @example
 * ```typescript
 * replacePlaceholders('{path}_{uuid}', [['{path}', 'folder/note'], ['{uuid}', '123']])
 * // Returns 'folder/note_123'
 * ```
 */
export function replacePlaceholders(format: string, replacements: Array<[string, string]>): string {
    let result = format;

    for (const [placeholder, value] of replacements) {
        if (result.includes(placeholder)) {
            result = result.split(placeholder).join(value);
        }
    }

    return result;
}

/**
 * Checks if a format string contains a specific placeholder
 *
 * @param format - The format string to check
 * @param placeholder - The placeholder to search for
 * @returns True if placeholder exists in format
 */
export function hasPlaceholder(format: string, placeholder: string): boolean {
    return format.includes(placeholder);
}
