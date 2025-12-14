import type { HistorySettings } from '@/types';

/**
 * Default settings provider utilities.
 */

/**
 * Creates default global settings for branch settings when toggling off global mode.
 *
 * @param globalDefaults - The global default settings
 * @returns A copy of the global defaults with isGlobal set to false
 */
export function createIndependentSettingsFromGlobal(
    globalDefaults: HistorySettings
): HistorySettings & { isGlobal: false } {
    return { ...globalDefaults, isGlobal: false };
}

/**
 * Creates global settings marker.
 *
 * @returns Settings object indicating global mode
 */
export function createGlobalSettingsMarker(): { isGlobal: true } {
    return { isGlobal: true };
}
