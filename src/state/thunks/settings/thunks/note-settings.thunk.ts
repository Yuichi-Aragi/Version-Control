import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { HistorySettings } from '@/types';
import { UIService } from '@/services';
import { ManifestManager, EditHistoryManager, BackgroundTaskManager } from '@/core';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import type VersionControlPlugin from '@/main';
import { loadEffectiveSettingsForNote } from '@/state/thunks/core.thunks';
import { validateHistorySettingsUpdate } from '@/state/thunks/settings/validation';
import { updateGlobalSettings } from '@/state/thunks/settings/thunks/save-settings.thunk';
import {
    createIndependentSettingsFromGlobal,
    createGlobalSettingsMarker,
    mergeVersionHistorySettings,
    mergeEditHistorySettings,
} from '@/state/thunks/settings/helpers';

/**
 * Thunks for managing note-specific settings.
 */

/**
 * Toggles between global and per-note settings for the current note.
 *
 * @param applyGlobally - If true, note will follow global settings; if false, note will have independent settings
 * @returns Async thunk
 */
export const toggleGlobalSettings = (applyGlobally: boolean): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("A versioned note must be active to change this setting.", 4000);
        return;
    }
    const { noteId, viewMode } = state;

    try {
        if (viewMode === 'versions') {
            if (applyGlobally) {
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        branch.settings = createGlobalSettingsMarker();
                    }
                });
                uiService.showNotice("Note versions now follow global settings.", 3000);
            } else {
                const globalVersionDefaults = plugin.settings.versionHistorySettings;
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        branch.settings = createIndependentSettingsFromGlobal(globalVersionDefaults);
                    }
                });
                uiService.showNotice("Note versions now have independent settings.", 3000);
            }
        } else {
            // Edit Mode
            let editManifest = await editHistoryManager.getEditManifest(noteId);
            if (!editManifest) {
                // Should exist if we are viewing edits, but just in case
                uiService.showNotice("Edit history not initialized.", 3000);
                return;
            }

            if (applyGlobally) {
                editManifest.branches[editManifest.currentBranch]!.settings = createGlobalSettingsMarker();
            } else {
                const globalEditDefaults = plugin.settings.editHistorySettings;
                editManifest.branches[editManifest.currentBranch]!.settings = createIndependentSettingsFromGlobal(globalEditDefaults);
            }
            await editHistoryManager.saveEditManifest(noteId, editManifest);
            uiService.showNotice(`Note edits now ${applyGlobally ? 'follow global' : 'have independent'} settings.`, 3000);
        }

        dispatch(loadEffectiveSettingsForNote(noteId));

    } catch (error) {
        console.error(`VC: Failed to toggle global settings for note ${noteId}.`, error);
        uiService.showNotice("Failed to update settings. Please try again.", 5000);
        dispatch(loadEffectiveSettingsForNote(noteId));
    }
};

/**
 * Updates effective settings for the current note.
 * If the note is using global settings, updates the global defaults.
 * If the note has per-note settings, updates only the note's settings.
 *
 * @param settingsUpdate - Partial history settings to update
 * @returns Async thunk
 */
export const updateSettings = (settingsUpdate: Partial<HistorySettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const stateBeforeUpdate = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (stateBeforeUpdate.isRenaming) {
        uiService.showNotice("Cannot change settings while database is being renamed.");
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const { noteId, file, viewMode } = stateBeforeUpdate;
    const isUnderGlobalInfluence = stateBeforeUpdate.effectiveSettings.isGlobal;

    // Validate the proposed update against the schema
    const validationResult = validateHistorySettingsUpdate(settingsUpdate);
    if (!validationResult.success) {
        console.error("VC: Invalid settings update.", validationResult.error);
        uiService.showNotice("Failed to save settings: Invalid data.", 5000);
        return;
    }

    if (file && (settingsUpdate.hasOwnProperty('autoSaveOnSaveInterval') || settingsUpdate.hasOwnProperty('autoSaveOnSave'))) {
        const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);
        debouncerInfo?.debouncer.cancel();
        plugin.autoSaveDebouncers.delete(file.path);
    }

    // Optimistic UI update
    dispatch(appSlice.actions.updateEffectiveSettings({ ...stateBeforeUpdate.effectiveSettings, ...settingsUpdate }));
    backgroundTaskManager.syncWatchMode();

    try {
        if (isUnderGlobalInfluence) {
            // Update Global Settings based on view mode
            if (viewMode === 'versions') {
                const newVersionSettings = mergeVersionHistorySettings(plugin.settings.versionHistorySettings, settingsUpdate);
                dispatch(updateGlobalSettings({ versionHistorySettings: newVersionSettings }));
            } else {
                const newEditSettings = mergeEditHistorySettings(plugin.settings.editHistorySettings, settingsUpdate);
                dispatch(updateGlobalSettings({ editHistorySettings: newEditSettings }));
            }
        } else {
            if (!noteId) {
                throw new Error("Cannot save per-note settings without an active note ID.");
            }
            // Update Per-Note Settings
            if (viewMode === 'versions') {
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        if (!branch.settings) branch.settings = {};
                        branch.settings.isGlobal = false;
                        Object.assign(branch.settings, settingsUpdate);
                    }
                });
            } else {
                const editManifest = await editHistoryManager.getEditManifest(noteId);
                if (editManifest) {
                    const branch = editManifest.branches[editManifest.currentBranch];
                    if (branch) {
                        if (!branch.settings) branch.settings = {};
                        branch.settings.isGlobal = false;
                        Object.assign(branch.settings, settingsUpdate);
                        await editHistoryManager.saveEditManifest(noteId, editManifest);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`VC: Failed to update settings. Reverting UI.`, error);
        uiService.showNotice("Failed to save settings. Reverting.", 5000);
        dispatch(loadEffectiveSettingsForNote(noteId));
    }
};
