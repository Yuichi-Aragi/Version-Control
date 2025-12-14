import { TFile, App } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { initializeView } from '@/state/thunks/core.thunks';
import { VersionManager, BackgroundTaskManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import type { SaveVersionOptions } from '../types';
import {
    validateReadyState,
    validateFileExists,
    validateNotRenaming,
} from '../validation';
import {
    handleVersionError,
    updateStateWithNewVersion,
    notifyVersionSaved,
    notifyVersionSavedInBackground,
    notifyDuplicateContent,
} from '../helpers';

/**
 * Saves a new version of the active file.
 *
 * This thunk handles both manual and automatic version saves. It performs validation,
 * creates the version, and updates the UI state accordingly.
 *
 * @param options - Save options including isAuto flag and settings override.
 * @returns An async thunk that performs the save operation.
 */
export const saveNewVersion = (options: SaveVersionOptions = {}): AppThunk => async (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const { isAuto = false, settings } = options;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();

    // Validate not renaming
    if (!validateNotRenaming(initialState.isRenaming, uiService, 'save version')) {
        if (!isAuto) {
            return;
        }
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const app = container.get<App>(TYPES.App);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    // Validate ready state
    if (!validateReadyState(initialState, uiService, isAuto)) {
        return;
    }

    const initialFileFromState = initialState.file;
    if (!validateFileExists(initialFileFromState, uiService, isAuto)) {
        return;
    }

    dispatch(appSlice.actions.setProcessing(true));

    try {
        // Verify file still exists on disk
        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (!(liveFile instanceof TFile)) {
            uiService.showNotice(
                `VC: Cannot save because the note "${initialFileFromState.basename}" may have been moved or deleted.`
            );
            dispatch(initializeView());
            return;
        }

        // Determine settings to use:
        // 1. Explicit settings passed in options (e.g. from BackgroundTaskManager)
        // 2. Fallback to effective settings from state (for manual saves)
        let settingsToUse;

        if (settings) {
            settingsToUse = settings;
        } else {
            const effectiveHistorySettings = initialState.effectiveSettings;
            settingsToUse = {
                ...initialState.settings, // Global VersionControlSettings (contains ID formats)
                ...effectiveHistorySettings, // Flattened effective history settings (overrides logic flags)
            };
        }

        const result = await versionManager.saveNewVersionForFile(liveFile, {
            isAuto,
            settings: settingsToUse,
        });

        // If manual save, reset the timer to skip the next immediate auto-save turn
        if (!isAuto) {
            backgroundTaskManager.resetTimer('version');
        }

        const stateAfterSave = getState();
        if (
            isPluginUnloading(container) ||
            stateAfterSave.status !== AppStatus.READY ||
            stateAfterSave.file?.path !== initialFileFromState.path
        ) {
            if (result.status === 'saved') {
                notifyVersionSavedInBackground(uiService, result.displayName, liveFile);
            }
            return;
        }

        if (result.status === 'duplicate' || result.status === 'skipped_min_lines') {
            if (!isAuto && result.status === 'duplicate') {
                notifyDuplicateContent(uiService);
            }
            return;
        }

        const { newVersionEntry, displayName, newNoteId } = result;
        if (newVersionEntry) {
            updateStateWithNewVersion(dispatch, newVersionEntry, newNoteId, initialState.noteId);

            if (!isAuto) {
                notifyVersionSaved(uiService, displayName, liveFile);
            }
        }
    } catch (error) {
        handleVersionError(error, 'saveNewVersion', uiService, isAuto);
        dispatch(initializeView());
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
            const finalState = getState();
            if (finalState.status === AppStatus.READY) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    }
};
