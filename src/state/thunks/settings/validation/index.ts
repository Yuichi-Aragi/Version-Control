/**
 * Validation utilities for settings.
 */

export {
    validateGlobalSettings,
    validateHistorySettingsUpdate,
    validateFrontmatterKey,
    validateNoteIdFormat,
    validateVersionIdFormat,
    validateDatabasePath,
    type ValidationResult,
} from './settings-validator';

export {
    safeValidate,
    strictValidate,
    type SafeParseResult,
} from './schema-validator';
