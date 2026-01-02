import * as v from 'valibot';
import type { AppThunk, Services } from '@/state';
import { appSlice } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import type { EditDetails } from '../types';
import { EditDetailsSchema } from '@/state/thunks/schemas';
import { historyApi } from '@/state/apis/history.api';
import { validateReadyState, validateNoteContext } from '@/state/utils/thunk-validation';

/**
 * Updates the metadata (name and description) of an edit
 */
export const updateEditDetails =
    (editId: string, details: EditDetails): AppThunk =>
    async (dispatch, getState, services: Services) => {
        if (shouldAbort(services, getState)) return;

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

        if (!validateReadyState(state, uiService)) return;
        if (!validateNoteContext(state.noteId, state.file)) return;
        
        // validateNoteContext ensures noteId is not null, but we must assert it for TS
        const noteId = state.noteId!;

        // 1. Optimistic Update: Timeline Panel
        dispatch(
            appSlice.actions.updateTimelineEventInState({
                versionId: editId,
                ...details,
            })
        );

        try {
            await editHistoryManager.updateEditMetadata(noteId, editId, details.name, details.description);
            eventBus.trigger('version-updated', noteId, editId, details);
            
            // Invalidate to refresh list
            dispatch(historyApi.util.invalidateTags([{ type: 'EditHistory', id: noteId }]));

        } catch (error) {
            console.error('VC: Failed to update edit details', error);
            uiService.showNotice('Failed to update edit details.');
            dispatch(historyApi.util.invalidateTags([{ type: 'EditHistory', id: noteId }]));
        } finally {
            if (!shouldAbort(services, getState)) {
                dispatch(appSlice.actions.stopVersionEditing());
            }
        }
    };
