import { produce } from 'immer';
import type { VersionControlSettings, HistorySettings } from '@/types';

/**
 * Settings merger utilities for combining global and per-note settings.
 * Uses Immer to ensure immutability during merge operations.
 */

/**
 * Merges global settings with a settings update.
 *
 * @param globalSettings - The current global settings
 * @param settingsUpdate - Partial settings to merge
 * @returns Merged settings object
 */
export function mergeGlobalSettings(
    globalSettings: VersionControlSettings,
    settingsUpdate: Partial<VersionControlSettings>
): VersionControlSettings {
    return produce(globalSettings, (draft) => {
        Object.assign(draft, settingsUpdate);
    });
}

/**
 * Merges version history settings with an update.
 *
 * @param versionSettings - Current version history settings
 * @param settingsUpdate - Partial settings to merge
 * @returns Merged version history settings
 */
export function mergeVersionHistorySettings(
    versionSettings: HistorySettings,
    settingsUpdate: Partial<HistorySettings>
): HistorySettings {
    return produce(versionSettings, (draft) => {
        Object.assign(draft, settingsUpdate);
    });
}

/**
 * Merges edit history settings with an update.
 *
 * @param editSettings - Current edit history settings
 * @param settingsUpdate - Partial settings to merge
 * @returns Merged edit history settings
 */
export function mergeEditHistorySettings(
    editSettings: HistorySettings,
    settingsUpdate: Partial<HistorySettings>
): HistorySettings {
    return produce(editSettings, (draft) => {
        Object.assign(draft, settingsUpdate);
    });
}

/**
 * Updates legacy frontmatter keys with a new key.
 *
 * @param currentLegacyKeys - Current array of legacy keys
 * @param oldKey - The old key to add to legacy keys
 * @returns Updated array of unique legacy keys
 */
export function updateLegacyKeys(
    currentLegacyKeys: string[] | undefined,
    oldKey: string
): string[] {
    const legacyKeys = currentLegacyKeys || [];
    // Using Set for uniqueness is cleaner than Immer here
    return Array.from(new Set([...legacyKeys, oldKey]));
}
