import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { initializeView, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { deleteAllEdits } from '@/state/thunks/edit-history/thunks/delete-edits.thunk';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { validateNotRenaming, validateNoteContext } from '../validation';
import {
    handleVersionErrorWithMessage,
    notifyDeleteSuccess,
    notifyDeleteInBackground,
    notifyDeleteAllSuccess,
    notifyDeleteAllInBackground,
} from '../helpers';

/**
 * Prompts the user to confirm deleting a version.
 */
export const requestDelete = (version: VersionHistoryEntry): any => (
    dispatch: any,
    getState: any,
    services: any
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status === AppStatus.READY) {
        const { file } = state;
        if (!file) return;

        const versionLabel = version.name
            ? `"${version.name}" (V${version.versionNumber})`
            : `Version ${version.versionNumber}`;
        
        const message = `Are you sure you want to permanently delete ${versionLabel} for "${file.basename}"? This action cannot be undone.`;

        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm delete',
                message: message,
                onConfirmAction: deleteVersion(version.id),
            })
        );
    }
};

/**
 * Deletes a version from the history.
 */
export const deleteVersion = createAsyncThunk<
    void,
    string,
    ThunkConfig
>(
    'version/deleteVersion',
    async (versionId, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const uiService = services.uiService;
        const initialState = getState().app;

        if (!validateNotRenaming(initialState.isRenaming, uiService, 'delete version')) {
            return rejectWithValue('Renaming in progress');
        }

        const versionManager = services.versionManager;
        const noteManager = services.noteManager;
        const app = services.app;

        if (initialState.status !== AppStatus.READY) return rejectWithValue('Not ready');

        const initialFileFromState = initialState.file;
        const initialNoteIdFromState = initialState.noteId;
        if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) return rejectWithValue('Invalid context');

        const file = initialFileFromState!;
        const noteId = initialNoteIdFromState!;

        dispatch(appSlice.actions.closePanel());

        try {
            const liveFile = app.vault.getAbstractFileByPath(file.path);
            if (liveFile instanceof TFile) {
                const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
                if (
                    currentNoteIdOnDisk !== noteId &&
                    currentNoteIdOnDisk !== null
                ) {
                    throw new Error(
                        `Delete failed. Note's version control ID has changed. Expected "${noteId}", found "${currentNoteIdOnDisk}".`
                    );
                }
            }

            const success = await versionManager.deleteVersion(noteId, versionId);

            // Race Check
            if (shouldAbort(services, getState, { noteId, filePath: file.path })) {
                if (success) {
                    notifyDeleteInBackground(uiService, file.basename);
                }
                return rejectWithValue('Context changed');
            }

            if (success) {
                dispatch(loadHistoryForNoteId({ file, noteId }));
                notifyDeleteSuccess(uiService, versionId);
                return;
            } else {
                throw new Error(`Failed to delete version ${versionId.substring(0, 6)}...`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
            handleVersionErrorWithMessage(
                error,
                'deleteVersion',
                `Delete failed: ${message}`,
                uiService,
                7000
            );
            if (!shouldAbort(services, getState)) {
                dispatch(initializeView(undefined));
            }
            return rejectWithValue(message);
        }
    }
);

/**
 * Prompts the user to confirm deleting all versions/edits.
 */
export const requestDeleteAll = (): any => (dispatch: any, getState: any, services: any) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status === AppStatus.READY) {
        const { file, currentBranch, viewMode } = state;
        if (!file || !currentBranch) return;

        const basename = file.basename;
        const typeLabel = viewMode === 'versions' ? 'version history' : 'edit history';
        const action = viewMode === 'versions' ? deleteAllVersions() : deleteAllEdits();

        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: `Delete all ${typeLabel}?`,
                message: `This will permanently delete all ${typeLabel} for the branch "${currentBranch}" of note "${basename}". This action cannot be undone. Are you sure?`,
                onConfirmAction: action,
            })
        );
    }
};

/**
 * Deletes all versions in the current branch.
 */
export const deleteAllVersions = createAsyncThunk<
    void,
    void,
    ThunkConfig
>(
    'version/deleteAllVersions',
    async (_, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const uiService = services.uiService;
        const initialState = getState().app;

        if (!validateNotRenaming(initialState.isRenaming, uiService, 'delete history')) {
            return rejectWithValue('Renaming in progress');
        }

        const versionManager = services.versionManager;

        if (initialState.status !== AppStatus.READY) return rejectWithValue('Not ready');

        const initialFileFromState = initialState.file;
        const initialNoteIdFromState = initialState.noteId;
        if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) return rejectWithValue('Invalid context');

        const file = initialFileFromState!;
        const noteId = initialNoteIdFromState!;

        dispatch(appSlice.actions.closePanel());

        try {
            const success = await versionManager.deleteAllVersionsInCurrentBranch(noteId);

            // Race Check
            if (shouldAbort(services, getState, { noteId, filePath: file.path })) {
                if (success) {
                    notifyDeleteAllInBackground(uiService, file.basename);
                }
                return rejectWithValue('Context changed');
            }

            if (success) {
                notifyDeleteAllSuccess(uiService, file.basename);
                dispatch(initializeView(undefined));
                return;
            } else {
                throw new Error(`Failed to delete all versions for "${file.basename}".`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
            handleVersionErrorWithMessage(
                error,
                'deleteAllVersions',
                `Delete all failed: ${message}`,
                uiService,
                7000
            );
            if (!shouldAbort(services, getState)) {
                dispatch(initializeView(undefined));
            }
            return rejectWithValue(message);
        }
    }
);