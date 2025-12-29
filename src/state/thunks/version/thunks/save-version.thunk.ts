import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import * as v from 'valibot';
import { AppStatus } from '@/state';
import { initializeView } from '@/state/thunks/core.thunks';
import { shouldAbort } from '@/state/utils/guards';
import type { SaveVersionOptions } from '../types';
import type { SaveVersionResult } from '@/types';
import type { ThunkConfig } from '@/state/store';
import { SaveVersionOptionsSchema } from '@/state/thunks/schemas';
import {
    validateReadyState,
    validateFileExists,
    validateNotRenaming,
} from '../validation';
import {
    handleVersionError,
    notifyVersionSaved,
    notifyVersionSavedInBackground,
    notifyDuplicateContent,
} from '../helpers';

/**
 * Saves a new version of the active file.
 *
 * This thunk handles both manual and automatic version saves. It performs validation,
 * creates the version, and updates the UI state accordingly.
 */
export const saveNewVersion = createAsyncThunk<
    SaveVersionResult | null, // Return result for reducer or null if validation/error
    SaveVersionOptions,
    ThunkConfig
>(
    'version/saveNewVersion',
    async (options = {}, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        // Aggressive Input Validation
        try {
            v.parse(SaveVersionOptionsSchema, options);
        } catch (validationError) {
            console.error("Version Control: Invalid SaveVersionOptions", validationError);
            return rejectWithValue('Invalid options');
        }

        const { isAuto = false, settings } = options;
        const uiService = services.uiService;
        const initialState = getState().app;

        // Validate not renaming
        if (!validateNotRenaming(initialState.isRenaming, uiService, 'save version')) {
            return rejectWithValue('Renaming in progress');
        }

        const versionManager = services.versionManager;
        const app = services.app;
        const backgroundTaskManager = services.backgroundTaskManager;

        // Validate ready state
        if (!validateReadyState(initialState, uiService, isAuto)) {
            return rejectWithValue('Not ready');
        }

        const initialFileFromState = initialState.file;
        if (!validateFileExists(initialFileFromState, uiService, isAuto)) {
            return rejectWithValue('No file');
        }

        // Note: setProcessing(true) is handled by extraReducers listening to pending

        try {
            // Verify file still exists on disk
            const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
            if (!(liveFile instanceof TFile)) {
                uiService.showNotice(
                    `VC: Cannot save because the note "${initialFileFromState.basename}" may have been moved or deleted.`
                );
                dispatch(initializeView(undefined));
                return rejectWithValue('File not found');
            }

            // Determine settings to use
            let settingsToUse;
            if (settings) {
                settingsToUse = settings;
            } else {
                const effectiveHistorySettings = initialState.effectiveSettings;
                settingsToUse = {
                    ...initialState.settings,
                    ...effectiveHistorySettings,
                };
            }

            // Construct options object conditionally to avoid passing undefined values
            // which violates exactOptionalPropertyTypes
            const saveOptions = {
                isAuto,
                settings: settingsToUse,
                ...(options.name !== undefined ? { name: options.name } : {}),
                ...(options.force !== undefined ? { force: options.force } : {}),
            };

            const result = await versionManager.saveNewVersionForFile(liveFile, saveOptions);

            // If manual save, reset the timer to skip the next immediate auto-save turn
            if (!isAuto) {
                backgroundTaskManager.resetTimer('version');
            }

            // Race Check
            if (shouldAbort(services, getState, { filePath: initialFileFromState.path, status: AppStatus.READY })) {
                if (result.status === 'saved') {
                    notifyVersionSavedInBackground(uiService, result.displayName, liveFile);
                }
                return rejectWithValue('Context changed');
            }

            if (result.status === 'duplicate' || result.status === 'skipped_min_lines') {
                if (!isAuto && result.status === 'duplicate') {
                    notifyDuplicateContent(uiService);
                }
                return null; // No state update needed
            }

            if (result.newVersionEntry) {
                if (!isAuto) {
                    notifyVersionSaved(uiService, result.displayName, liveFile);
                }
                // Return result for reducer to update state
                return result;
            }

            return null;

        } catch (error) {
            handleVersionError(error, 'saveNewVersion', uiService, isAuto);
            dispatch(initializeView(undefined));
            return rejectWithValue(error instanceof Error ? error.message : String(error));
        } finally {
            if (!shouldAbort(services, getState)) {
                backgroundTaskManager.syncWatchMode();
            }
        }
    }
);