/**
 * Settings module.
 *
 * This module provides thunks for managing application settings, including:
 * - Global settings updates
 * - Note-specific settings management
 * - Settings validation
 * - Version export functionality
 *
 * All thunks maintain proper Redux Toolkit createAsyncThunk patterns and use
 * absolute imports with '@/' alias.
 */

// Re-export all thunks
export {
    updateGlobalSettings,
    requestKeyUpdate,
    requestUpdateIdFormats,
    renameDatabasePath,
    toggleGlobalSettings,
    updateSettings,
    requestExportAllVersions,
    exportAllVersions,
    requestExportSingleVersion,
    exportSingleVersion,
} from './thunks';

// Re-export types
export type {
    ExportFormat,
    ExportFormatActionItem,
    FolderActionItem,
    SettingsUpdatePayload,
} from './types';

// Re-export helpers (if needed externally)
export {
    mergeGlobalSettings,
    mergeVersionHistorySettings,
    mergeEditHistorySettings,
    updateLegacyKeys,
    createIndependentSettingsFromGlobal,
    createGlobalSettingsMarker,
} from './helpers';

// Re-export validators (if needed externally)
export {
    validateGlobalSettings,
    validateHistorySettingsUpdate,
    validateFrontmatterKey,
    validateNoteIdFormat,
    validateVersionIdFormat,
    validateDatabasePath,
    safeValidate,
    strictValidate,
    type ValidationResult,
    type SafeParseResult,
} from './validation';
