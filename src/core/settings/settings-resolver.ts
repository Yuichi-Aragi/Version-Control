import { pickBy, isUndefined } from 'es-toolkit';
import type { HistorySettings } from '@/types';

/**
 * Helper type to allow undefined values in optional properties,
 * satisfying exactOptionalPropertyTypes: true constraints when
 * dealing with possibly undefined inputs from other sources (like Valibot partials).
 */
export type LoosePartial<T> = {
    [P in keyof T]?: T[P] | undefined;
};

/**
 * Centralized logic for resolving effective settings by merging global configurations
 * with branch-specific overrides. Enforces the "isGlobal" inheritance pattern.
 */
export class SettingsResolver {
    /**
     * Resolves the effective history settings for a specific branch.
     * 
     * @param globalDefaults The global settings from the plugin configuration.
     * @param branchSettings The optional settings override from a branch manifest.
     * @returns The merged effective settings.
     */
    static resolve(
        globalDefaults: HistorySettings,
        branchSettings?: LoosePartial<HistorySettings>
    ): HistorySettings {
        if (!branchSettings) {
            return { ...globalDefaults, isGlobal: true };
        }

        // If isGlobal is explicitly false, we use local overrides.
        // If isGlobal is undefined or true, we fallback to global defaults.
        const isUnderGlobalInfluence = branchSettings.isGlobal !== false;

        if (isUnderGlobalInfluence) {
            return { ...globalDefaults, isGlobal: true };
        }

        // Filter undefineds to ensure clean merge and strict type compliance
        const definedBranchSettings = pickBy(
            branchSettings,
            (value) => !isUndefined(value)
        ) as Partial<HistorySettings>;

        return { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
    }
}
