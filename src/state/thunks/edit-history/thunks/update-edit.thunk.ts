/**
 * Update Edit Thunk
 *
 * Handles updating edit metadata (name and description)
 */

import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager, PluginEvents } from '@/core';
import { UIService } from '@/services';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import { loadEditHistory } from './load-edit-history.thunk';
import type { EditDetails } from '../types';

/**
 * Updates the metadata (name and description) of an edit
 *
 * @param editId - The edit ID to update
 * @param details - The new name and description
 * @returns AppThunk that updates the edit details
 */
export const updateEditDetails =
    (editId: string, details: EditDetails): AppThunk =>
    async (dispatch, getState, container) => {
        if (isPluginUnloading(container)) return;

        const state = getState();
        const editHistoryManager =
            container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        const uiService = container.get<UIService>(TYPES.UIService);
        const eventBus = container.get<PluginEvents>(TYPES.EventBus);

        if (state.status !== AppStatus.READY || !state.noteId) return;
        const { noteId } = state;

        // 1. Optimistic Update: History List
        dispatch(
            appSlice.actions.updateVersionDetailsInState({
                versionId: editId,
                ...details,
            })
        );

        // 2. Optimistic Update: Timeline Panel
        dispatch(
            appSlice.actions.updateTimelineEventInState({
                versionId: editId,
                ...details,
            })
        );

        try {
            // Use high-level manager method for atomicity
            await editHistoryManager.updateEditMetadata(noteId, editId, details.name, details.description);

            // 3. Sync with Timeline DB via EventBus
            // This ensures the timeline worker DB is updated so future timeline loads are correct.
            eventBus.trigger('version-updated', noteId, editId, details);

        } catch (error) {
            console.error('VC: Failed to update edit details', error);
            uiService.showNotice('Failed to update edit details.');
            dispatch(loadEditHistory(noteId)); // Revert
        } finally {
            dispatch(appSlice.actions.stopVersionEditing());
        }
    };
