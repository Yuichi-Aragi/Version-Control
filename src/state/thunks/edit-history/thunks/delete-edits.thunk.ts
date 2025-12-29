/**
 * Delete Edits Thunk
 *
 * Handles deletion of edits and related confirmation dialogs
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { shouldAbort } from '@/state/utils/guards';
import { loadEditHistory } from './load-edit-history.thunk';
import type { ThunkConfig } from '@/state/store';

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

        if (state.status !== AppStatus.READY || !state.noteId) return rejectWithValue('Not ready');
        const { noteId } = state;

        dispatch(appSlice.actions.closePanel());
        // Ensure any pending diff involving this edit is cleared
        dispatch(appSlice.actions.clearDiffRequest());

        try {
            // Use high-level manager method that handles manifest update and deletion atomically
            await editHistoryManager.deleteEditEntry(noteId, editId);

            // Race Check: Verify context after async delete
            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            // Optimistic update for Timeline
            if (state.panel?.type === 'timeline' && state.viewMode === 'edits') {
                dispatch(appSlice.actions.removeTimelineEvent({ versionId: editId }));
            }

            // INSTANT UI UPDATE: Remove from local state immediately
            // We avoid calling loadEditHistory here to prevent UI lag/flicker from DB round-trip.
            dispatch(appSlice.actions.removeEditsSuccess({ ids: [editId] }));

            uiService.showNotice('Edit deleted.');
            return;
        } catch (error) {
            console.error('VC: Failed to delete edit', error);
            uiService.showNotice('Failed to delete edit.');
            // Only reload history if the operation failed, to ensure UI consistency
            if (!shouldAbort(services, getState, { noteId })) {
                dispatch(loadEditHistory(noteId));
            }
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

        if (state.status !== AppStatus.READY || !state.noteId) return rejectWithValue('Not ready');
        const { noteId } = state;

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

            // We iterate because EditHistoryManager doesn't expose a bulk delete for branch yet,
            // and we want to be safe with manifest updates.
            // Using deleteEditEntry ensures manifest is updated correctly for each removal.
            for (const editId of editIds) {
                await editHistoryManager.deleteEditEntry(noteId, editId);
            }

            // Race Check: Verify context after async deletes
            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            // INSTANT UI UPDATE: Clear local list immediately
            dispatch(appSlice.actions.editHistoryLoadedSuccess({ 
                editHistory: [],
                currentBranch: state.currentBranch,
                availableBranches: state.availableBranches,
                contextVersion: state.contextVersion
            }));
            
            // Clear timeline if open
            if (state.panel?.type === 'timeline' && state.viewMode === 'edits') {
                dispatch(appSlice.actions.setTimelineData([]));
            }

            uiService.showNotice('All edits in this branch deleted.');
            return;

        } catch (error) {
            console.error('VC: Failed to delete all edits', error);
            uiService.showNotice('Failed to delete all edits.');
            // Reload history on error to restore state
            if (!shouldAbort(services, getState, { noteId })) {
                dispatch(loadEditHistory(noteId));
            }
            return rejectWithValue(String(error));
        }
    }
);

/**
 * Opens a confirmation dialog before deleting an edit
 *
 * @param edit - The edit entry to delete
 * @returns AppThunk that opens the confirmation dialog
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
