import * as v from 'valibot';
import { VersionControlSettingsSchema, HistorySettingsSchema } from '@/schemas';
import type { VersionControlSettings, HistorySettings } from '@/types';

/**
 * Settings validation utilities.
 */

/**
 * Result of a validation operation.
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Validates global settings against the schema.
 *
 * @param settings - Settings to validate
 * @returns Validation result
 */
export function validateGlobalSettings(
    settings: VersionControlSettings
): ValidationResult<VersionControlSettings> {
    try {
        const validatedData = v.parse(VersionControlSettingsSchema, settings);
        return { success: true, data: validatedData };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Validation failed';
        return { success: false, error: errorMessage };
    }
}

/**
 * Validates partial history settings against the schema.
 *
 * @param settingsUpdate - Partial settings to validate
 * @returns Validation result
 */
export function validateHistorySettingsUpdate(
    settingsUpdate: Partial<HistorySettings>
): ValidationResult<Partial<HistorySettings>> {
    const result = v.safeParse(v.partial(HistorySettingsSchema), settingsUpdate);
    if (result.success) {
        return { success: true, data: result.output as Partial<HistorySettings> };
    }
    const errorMessage = result.issues[0]?.message ?? 'Invalid settings data';
    return { success: false, error: errorMessage };
}

/**
 * Validates a frontmatter key.
 *
 * @param key - The key to validate
 * @returns Validation result
 */
export function validateFrontmatterKey(key: string): ValidationResult<string> {
    const result = v.safeParse(VersionControlSettingsSchema.entries.noteIdFrontmatterKey, key);
    if (result.success) {
        return { success: true, data: result.output };
    }
    const errorMessage = result.issues[0]?.message ?? 'Invalid frontmatter key';
    return { success: false, error: errorMessage };
}

/**
 * Validates note ID format.
 *
 * @param format - The format to validate
 * @returns Validation result
 */
export function validateNoteIdFormat(format: string): ValidationResult<string> {
    const result = v.safeParse(VersionControlSettingsSchema.entries.noteIdFormat, format);
    if (result.success) {
        return { success: true, data: result.output };
    }
    const errorMessage = result.issues[0]?.message ?? 'Invalid note ID format';
    return { success: false, error: errorMessage };
}

/**
 * Validates version ID format.
 *
 * @param format - The format to validate
 * @returns Validation result
 */
export function validateVersionIdFormat(format: string): ValidationResult<string> {
    const result = v.safeParse(VersionControlSettingsSchema.entries.versionIdFormat, format);
    if (result.success) {
        return { success: true, data: result.output };
    }
    const errorMessage = result.issues[0]?.message ?? 'Invalid version ID format';
    return { success: false, error: errorMessage };
}

/**
 * Validates database path.
 *
 * @param path - The path to validate
 * @returns Validation result
 */
export function validateDatabasePath(path: string): ValidationResult<string> {
    const result = v.safeParse(VersionControlSettingsSchema.entries.databasePath, path);
    if (result.success) {
        return { success: true, data: result.output };
    }
    const errorMessage = result.issues[0]?.message ?? 'Invalid database path';
    return { success: false, error: errorMessage };
}
