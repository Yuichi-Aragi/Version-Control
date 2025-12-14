/**
 * Delete Edits Thunk
 *
 * Handles deletion of edits and related confirmation dialogs
 */

import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager } from '@/core';
import { UIService } from '@/services';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import { loadEditHistory } from './load-edit-history.thunk';

/**
 * Deletes an edit from the history
 *
 * @param editId - The edit ID to delete
 * @returns AppThunk that deletes the edit
 */
export const deleteEdit =
    (editId: string): AppThunk =>
    async (dispatch, getState, container) => {
        if (isPluginUnloading(container)) return;

        const state = getState();
        const editHistoryManager =
            container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        const uiService = container.get<UIService>(TYPES.UIService);

        if (state.status !== AppStatus.READY || !state.noteId) return;
        const { noteId } = state;

        dispatch(appSlice.actions.setProcessing(true));
        dispatch(appSlice.actions.closePanel());

        try {
            const manifest = await editHistoryManager.getEditManifest(noteId);
            if (!manifest) throw new Error('Manifest not found');

            const branchName = manifest.currentBranch;
            const branch = manifest.branches[branchName];

            if (branch && branch.versions[editId]) {
                delete branch.versions[editId];
                manifest.lastModified = new Date().toISOString();

                // MODIFIED: Removed logic that deletes the branch or note history if empty.
                // This ensures deleting the last edit only clears the list, preserving the branch structure
                // for potential Version History or future edits.
                
                await editHistoryManager.saveEditManifest(noteId, manifest);
            }

            await editHistoryManager.deleteEdit(noteId, branchName, editId);

            dispatch(loadEditHistory(noteId));
            uiService.showNotice('Edit deleted.');
        } catch (error) {
            console.error('VC: Failed to delete edit', error);
            uiService.showNotice('Failed to delete edit.');
        } finally {
            if (!isPluginUnloading(container)) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    };

/**
 * Deletes all edits in the current branch
 * 
 * @returns AppThunk
 */
export const deleteAllEdits = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    dispatch(appSlice.actions.setProcessing(true));
    dispatch(appSlice.actions.closePanel());

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

        // 1. Delete from IDB
        // We iterate because EditHistoryManager doesn't expose a bulk delete for branch yet,
        // and we want to be safe.
        for (const editId of editIds) {
            await editHistoryManager.deleteEdit(noteId, branchName, editId);
        }

        // 2. Clear from Manifest
        branch.versions = {};
        // We do NOT reset totalVersions to ensure unique IDs if user continues editing, 
        // or we could reset it. For safety with ID generation based on max version, 
        // keeping totalVersions or resetting it depends on ID generation strategy.
        // Current strategy: `calculateNextVersionNumber` uses `Object.values(branch.versions)`.
        // If we clear versions, next is 1. This is fine for "Delete All".
        
        manifest.lastModified = new Date().toISOString();
        await editHistoryManager.saveEditManifest(noteId, manifest);

        dispatch(loadEditHistory(noteId));
        uiService.showNotice('All edits in this branch deleted.');

    } catch (error) {
        console.error('VC: Failed to delete all edits', error);
        uiService.showNotice('Failed to delete all edits.');
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(appSlice.actions.setProcessing(false));
        }
    }
};

/**
 * Opens a confirmation dialog before deleting an edit
 *
 * @param edit - The edit entry to delete
 * @returns AppThunk that opens the confirmation dialog
 */
export const requestDeleteEdit =
    (edit: VersionHistoryEntry): AppThunk =>
    (dispatch, _getState, _container) => {
        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm delete edit',
                message: `Permanently delete this edit?`,
                onConfirmAction: deleteEdit(edit.id),
            })
        );
    };
