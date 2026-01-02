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
} from '@/state/utils/thunk-validation';
import {
    handleVersionError,
    notifyVersionSaved,
    notifyVersionSavedInBackground,
    notifyDuplicateContent,
} from '../helpers';
import { historyApi } from '@/state/apis/history.api';

/**
 * Saves a new version of the active file.
 */
export const saveNewVersion = createAsyncThunk<
    SaveVersionResult | null,
    SaveVersionOptions,
    ThunkConfig
>(
    'version/saveNewVersion',
    async (options = {}, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        try {
            v.parse(SaveVersionOptionsSchema, options);
        } catch (validationError) {
            console.error("Version Control: Invalid SaveVersionOptions", validationError);
            return rejectWithValue('Invalid options');
        }

        const { isAuto = false, settings } = options;
        const uiService = services.uiService;
        const initialState = getState().app;

        if (!validateNotRenaming(initialState.isRenaming, uiService, 'save version')) {
            return rejectWithValue('Renaming in progress');
        }

        const versionManager = services.versionManager;
        const app = services.app;
        const backgroundTaskManager = services.backgroundTaskManager;

        if (!validateReadyState(initialState, uiService, isAuto)) {
            return rejectWithValue('Not ready');
        }

        const initialFileFromState = initialState.file;
        if (!validateFileExists(initialFileFromState, uiService, isAuto)) {
            return rejectWithValue('No file');
        }

        try {
            const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
            if (!(liveFile instanceof TFile)) {
                uiService.showNotice(
                    `VC: Cannot save because the note "${initialFileFromState.basename}" may have been moved or deleted.`
                );
                dispatch(initializeView(undefined));
                return rejectWithValue('File not found');
            }

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

            const saveOptions = {
                isAuto,
                settings: settingsToUse,
                ...(options.name !== undefined ? { name: options.name } : {}),
                ...(options.force !== undefined ? { force: options.force } : {}),
            };

            const result = await versionManager.saveNewVersionForFile(liveFile, saveOptions);

            if (!isAuto) {
                backgroundTaskManager.resetTimer('version');
            }

            if (shouldAbort(services, getState, { filePath: initialFileFromState.path, status: AppStatus.READY })) {
                if (result.status === 'saved') {
                    notifyVersionSavedInBackground(uiService, result.displayName, liveFile);
                    // Even if context changed, we should invalidate tags for the noteId involved
                    if (result.newNoteId) {
                        dispatch(historyApi.util.invalidateTags([
                            { type: 'VersionHistory', id: result.newNoteId },
                            { type: 'Branches', id: result.newNoteId }
                        ]));
                    }
                }
                return rejectWithValue('Context changed');
            }

            if (result.status === 'duplicate' || result.status === 'skipped_min_lines') {
                if (!isAuto && result.status === 'duplicate') {
                    notifyDuplicateContent(uiService);
                }
                return null;
            }

            if (result.newVersionEntry) {
                if (!isAuto) {
                    notifyVersionSaved(uiService, result.displayName, liveFile);
                }
                
                // Invalidate RTK Query tags to refresh UI
                if (result.newNoteId) {
                    dispatch(historyApi.util.invalidateTags([
                        { type: 'VersionHistory', id: result.newNoteId },
                        { type: 'Branches', id: result.newNoteId }
                    ]));
                }
                
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
