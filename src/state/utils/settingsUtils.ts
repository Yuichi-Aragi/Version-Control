import type { Container } from 'inversify';
import type { HistorySettings } from '../../types';
import { TYPES } from '../../types/inversify.types';
import type VersionControlPlugin from '../../main';
import type { ManifestManager } from '../../core/manifest-manager';
import type { EditHistoryManager } from '../../core/edit-history-manager';

/**
 * Resolves the effective settings for a given note and history type (version or edit).
 * Determines whether to use global settings or per-note/per-branch settings.
 * 
 * This function ensures consistency by:
 * 1. Always using the NoteManifest as the source of truth for the current branch.
 * 2. Correctly merging global defaults with local overrides.
 * 3. Handling the 'isGlobal' flag logic (defaulting to true if undefined).
 */
export async function resolveSettings(
    noteId: string, 
    type: 'version' | 'edit', 
    container: Container
): Promise<HistorySettings> {
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    
    const globalDefaults = type === 'version' 
        ? plugin.settings.versionHistorySettings 
        : plugin.settings.editHistorySettings;
        
    try {
        // 1. Authoritative Branch Determination from NoteManifest
        // NoteManifest is the source of truth for the "Current Branch" of a note.
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        
        // If note manifest is missing, we default to global settings
        if (!noteManifest) {
            return { ...globalDefaults, isGlobal: true };
        }

        const currentBranch = noteManifest.currentBranch;
        let perBranchSettings: Partial<HistorySettings> | undefined;
        
        // Helper to filter out undefined values for exactOptionalPropertyTypes compatibility
        const filterDefinedSettings = (settings: Record<string, unknown> | undefined): Partial<HistorySettings> | undefined => {
            if (!settings) return undefined;
            return Object.fromEntries(
                Object.entries(settings).filter(([, v]) => v !== undefined)
            ) as Partial<HistorySettings>;
        };

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
        
        if (isUnderGlobalInfluence) {
            return { ...globalDefaults, isGlobal: true };
        } else {
            // Filter undefineds to ensure clean merge (don't overwrite defaults with undefined)
            const definedBranchSettings = Object.fromEntries(
                Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
            );
            // Local overrides Global
            return { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
        }
    } catch (e) {
        console.error("Version Control: Error resolving settings", e);
        return { ...globalDefaults, isGlobal: true };
    }
}

/**
 * Checks if the plugin is in the process of unloading.
 * This is a crucial guard to prevent thunks from executing against a destroyed
 * or partially destroyed dependency injection container.
 */
export const isPluginUnloading = (container: Container): boolean => {
    try {
        const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
        if (plugin.isUnloading) {
            return true;
        }
        return false;
    } catch (e) {
        return true;
    }
};
