import { pickBy, isUndefined } from 'es-toolkit';
import * as v from 'valibot';
import type { HistorySettings } from '@/types';
import type { Services } from '../store';
import { DEFAULT_SETTINGS } from '@/constants';
import { HistorySettingsSchema } from '@/schemas';

/**
 * Filters out undefined values from a settings object using es-toolkit.
 * Used for exactOptionalPropertyTypes compatibility.
 */
const filterDefinedSettings = (settings: Record<string, unknown> | undefined): Partial<HistorySettings> | undefined => {
    if (!settings) return undefined;
    return pickBy(settings, (value) => !isUndefined(value)) as Partial<HistorySettings>;
};

/**
 * Resolves the effective settings for a given note and history type (version or edit).
 * Determines whether to use global settings or per-note/per-branch settings.
 *
 * This function ensures consistency by:
 * 1. Always using the NoteManifest as the source of truth for the current branch.
 * 2. Correctly merging global defaults with local overrides.
 * 3. Handling the 'isGlobal' flag logic (defaulting to true if undefined).
 * 4. Validating the final output against the schema.
 */
export async function resolveSettings(
    noteId: string,
    type: 'version' | 'edit',
    services: Services
): Promise<HistorySettings> {
    // Defensive check: ensure plugin and settings are available
    if (!services?.plugin?.settings) {
        console.warn("Version Control: Plugin settings not available, using defaults");
        const defaultSettings = type === 'version'
            ? { ...DEFAULT_SETTINGS.versionHistorySettings, isGlobal: true }
            : { ...DEFAULT_SETTINGS.editHistorySettings, isGlobal: true };
        return v.parse(HistorySettingsSchema, defaultSettings);
    }

    const { manifestManager, editHistoryManager, plugin } = services;
    const globalDefaults = type === 'version'
        ? plugin.settings.versionHistorySettings
        : plugin.settings.editHistorySettings;

    try {
        // 1. Authoritative Branch Determination from NoteManifest
        // NoteManifest is the source of truth for the "Current Branch" of a note.
        const noteManifest = await manifestManager.loadNoteManifest(noteId);

        // If note manifest is missing, we default to global settings
        if (!noteManifest) {
            return v.parse(HistorySettingsSchema, { ...globalDefaults, isGlobal: true });
        }

        const currentBranch = noteManifest.currentBranch;
        let perBranchSettings: Partial<HistorySettings> | undefined;

        if (type === 'version') {
            const branch = noteManifest.branches[currentBranch];
            perBranchSettings = filterDefinedSettings(branch?.settings);
        } else {
            // For edits, we use the branch name from NoteManifest to query EditManifest.
            // This ensures we are looking at the settings for the active context, even if
            // the EditManifest hasn't been synced for a new branch yet.
            const editManifest = await editHistoryManager.getEditManifest(noteId);
            if (editManifest) {
                const branch = editManifest.branches[currentBranch];
                perBranchSettings = filterDefinedSettings(branch?.settings);
            }
        }

        // Default to Global if isGlobal is undefined or true.
        // Explicit 'false' is required to enable local settings.
        const isUnderGlobalInfluence = perBranchSettings?.isGlobal !== false;

        let finalSettings: HistorySettings;

        if (isUnderGlobalInfluence) {
            finalSettings = { ...globalDefaults, isGlobal: true };
        } else {
            // Filter undefineds using es-toolkit pickBy to ensure clean merge
            const definedBranchSettings = pickBy(
                perBranchSettings ?? {},
                (value) => !isUndefined(value)
            );
            // Local overrides Global
            finalSettings = { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
        }

        // Strict validation of the resolved settings
        return v.parse(HistorySettingsSchema, finalSettings);

    } catch (e) {
        console.error("Version Control: Error resolving settings", e);
        return v.parse(HistorySettingsSchema, { ...globalDefaults, isGlobal: true });
    }
}
