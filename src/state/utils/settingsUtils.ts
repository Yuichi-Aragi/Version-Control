import type { Container } from 'inversify';
import type { HistorySettings } from '../../types';
import { TYPES } from '../../types/inversify.types';
import type VersionControlPlugin from '../../main';
import type { ManifestManager } from '../../core/manifest-manager';
import type { EditHistoryManager } from '../../core/edit-history-manager';

/**
 * Resolves the effective settings for a given note and history type (version or edit).
 * Determines whether to use global settings or per-note/per-branch settings.
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
        let perBranchSettings: Partial<HistorySettings> | undefined;
        
        if (type === 'version') {
            const manifest = await manifestManager.loadNoteManifest(noteId);
            if (manifest) {
                perBranchSettings = Object.fromEntries(
                    Object.entries(manifest.branches[manifest.currentBranch]?.settings || {}).filter(([, v]) => v !== undefined)
                ) as Partial<HistorySettings>;
            }
        } else {
            const manifest = await editHistoryManager.getEditManifest(noteId);
            if (manifest) {
                perBranchSettings = Object.fromEntries(
                    Object.entries(manifest.branches[manifest.currentBranch]?.settings || {}).filter(([, v]) => v !== undefined)
                ) as Partial<HistorySettings>;
            }
        }
        
        const isUnderGlobalInfluence = perBranchSettings?.isGlobal === true || perBranchSettings === undefined;
        
        if (isUnderGlobalInfluence) {
            return { ...globalDefaults, isGlobal: true };
        } else {
            const definedBranchSettings = Object.fromEntries(
                Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
            );
            return { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
        }
    } catch (e) {
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
