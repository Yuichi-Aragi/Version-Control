import * as v from 'valibot';
import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import { loadEditHistory } from './load-edit-history.thunk';
import type { EditDetails } from '../types';
import { EditDetailsSchema } from '@/state/thunks/schemas';

/**
 * Update Edit Thunk
 *
 * Handles updating edit metadata (name and description)
 */

/**
 * Updates the metadata (name and description) of an edit
 *
 * @param editId - The edit ID to update
 * @param details - The new name and description
 * @returns AppThunk that updates the edit details
 */
export const updateEditDetails =
    (editId: string, details: EditDetails): AppThunk =>
    async (dispatch, getState, services: Services) => {
        if (shouldAbort(services, getState)) return;

        // Aggressive Input Validation
        try {
            v.parse(EditDetailsSchema, details);
        } catch (validationError) {
            console.error("Version Control: Invalid EditDetails", validationError);
            return;
        }

        const state = getState().app;
        const editHistoryManager = services.editHistoryManager;
        const uiService = services.uiService;
        const eventBus = services.eventBus;

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
            if (!shouldAbort(services, getState, { noteId })) {
                dispatch(loadEditHistory(noteId)); // Revert
            }
        } finally {
            if (!shouldAbort(services, getState)) {
                dispatch(appSlice.actions.stopVersionEditing());
            }
        }
    };