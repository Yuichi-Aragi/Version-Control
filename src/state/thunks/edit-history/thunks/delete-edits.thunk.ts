import { createAsyncThunk } from '@reduxjs/toolkit';
import type { AppThunk } from '@/state';
import { appSlice } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { historyApi } from '@/state/apis/history.api';
import { validateReadyState, validateNoteContext } from '@/state/utils/thunk-validation';

/**
 * Deletes an edit from the history
 */
export const deleteEdit = createAsyncThunk<
    void,
    string,
    ThunkConfig
>(
    'editHistory/deleteEdit',
    async (editId, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const state = getState().app;
        const editHistoryManager = services.editHistoryManager;
        const uiService = services.uiService;

        if (!validateReadyState(state, uiService)) return rejectWithValue('Not ready');
        if (!validateNoteContext(state.noteId, state.file)) return rejectWithValue('Invalid context');
        
        const noteId = state.noteId!;

        dispatch(appSlice.actions.closePanel());
        dispatch(appSlice.actions.clearDiffRequest());

        try {
            await editHistoryManager.deleteEditEntry(noteId, editId);

            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            // Invalidate RTK Query tag
            dispatch(historyApi.util.invalidateTags([
                { type: 'EditHistory', id: noteId },
                { type: 'Timeline', id: noteId }
            ]));

            uiService.showNotice('Edit deleted.');
            return;
        } catch (error) {
            console.error('VC: Failed to delete edit', error);
            uiService.showNotice('Failed to delete edit.');
            dispatch(historyApi.util.invalidateTags([{ type: 'EditHistory', id: noteId }]));
            return rejectWithValue(String(error));
        }
    }
);

/**
 * Deletes all edits in the current branch
 */
export const deleteAllEdits = createAsyncThunk<
    void,
    void,
    ThunkConfig
>(
    'editHistory/deleteAllEdits',
    async (_, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const state = getState().app;
        const editHistoryManager = services.editHistoryManager;
        const uiService = services.uiService;

        if (!validateReadyState(state, uiService)) return rejectWithValue('Not ready');
        if (!validateNoteContext(state.noteId, state.file)) return rejectWithValue('Invalid context');
        
        const noteId = state.noteId!;

        dispatch(appSlice.actions.closePanel());
        dispatch(appSlice.actions.clearDiffRequest());

        try {
            const manifest = await editHistoryManager.getEditManifest(noteId);
            if (!manifest) throw new Error('Manifest not found');

            const branchName = manifest.currentBranch;
            const branch = manifest.branches[branchName];

            if (!branch) {
                 uiService.showNotice('No edits to delete.');
                 return;
            }

            const editIds = Object.keys(branch.versions);
            if (editIds.length === 0) {
                uiService.showNotice('No edits to delete.');
                return;
            }

            for (const editId of editIds) {
                await editHistoryManager.deleteEditEntry(noteId, editId);
            }

            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            // Invalidate RTK Query tag
            dispatch(historyApi.util.invalidateTags([
                { type: 'EditHistory', id: noteId },
                { type: 'Timeline', id: noteId }
            ]));
            
            uiService.showNotice('All edits in this branch deleted.');
            return;

        } catch (error) {
            console.error('VC: Failed to delete all edits', error);
            uiService.showNotice('Failed to delete all edits.');
            dispatch(historyApi.util.invalidateTags([{ type: 'EditHistory', id: noteId }]));
            return rejectWithValue(String(error));
        }
    }
);

/**
 * Opens a confirmation dialog before deleting an edit
 */
export const requestDeleteEdit =
    (edit: VersionHistoryEntry): AppThunk =>
    (dispatch, _getState, _services) => {
        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm delete edit',
                message: `Permanently delete this edit?`,
                onConfirmAction: deleteEdit(edit.id),
            })
        );
    };
