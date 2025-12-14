/**
 * Helper utilities for settings thunks.
 */

export {
    mergeGlobalSettings,
    mergeVersionHistorySettings,
    mergeEditHistorySettings,
    updateLegacyKeys,
} from './settings-merger';

export {
    createIndependentSettingsFromGlobal,
    createGlobalSettingsMarker,
} from './default-provider';
