import * as v from 'valibot';
import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { shouldAbort } from '@/state/utils/guards';
import type { UpdateVersionDetailsPayload } from '../types';
import { UpdateVersionDetailsPayloadSchema } from '@/state/thunks/schemas';
import { validateNotRenaming, validateNoteContext } from '../validation';
import { updateVersionDetailsInState } from '../helpers';

/**
 * Updates the name and description of a version.
 *
 * This operation is optimistic - the UI is updated immediately, and if the
 * backend update fails, the state is reverted by reloading history.
 *
 * @param versionId - The ID of the version to update.
 * @param details - The new name and description.
 * @returns An async thunk that performs the update operation.
 */
export const updateVersionDetails = (
    versionId: string,
    details: UpdateVersionDetailsPayload
): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;

    // Aggressive Input Validation
    try {
        v.parse(UpdateVersionDetailsPayloadSchema, details);
    } catch (validationError) {
        console.error("Version Control: Invalid UpdateVersionDetailsPayload", validationError);
        return;
    }

    const uiService = services.uiService;
    const state = getState().app;

    // Validate not renaming
    if (!validateNotRenaming(state.isRenaming, uiService, 'edit version')) {
        return;
    }

    const versionManager = services.versionManager;

    if (state.status !== AppStatus.READY) {
        return;
    }

    const initialNoteId = state.noteId;
    const initialFile = state.file;
    if (!validateNoteContext(initialNoteId, initialFile)) {
        return;
    }

    // At this point, we know both are non-null (validated above)
    const noteId = initialNoteId!;
    const file = initialFile!;

    const updatePayload = {
        name: details.name.trim(),
        description: details.description.trim(),
    };

    // Optimistically update the UI for the current version ID
    updateVersionDetailsInState(dispatch, versionId, updatePayload.name, updatePayload.description);

    try {
        const newVersionId = await versionManager.updateVersionDetails(
            noteId,
            versionId,
            updatePayload
        );

        // Trigger event to update IndexedDB timeline metadata
        const eventBus = services.eventBus;
        eventBus.trigger('version-updated', noteId, versionId, updatePayload);

        // If the ID changed due to renaming, we must reload the history to reflect the new ID in the state
        if (newVersionId !== versionId) {
            if (!shouldAbort(services, getState, { noteId })) {
                dispatch(loadHistoryForNoteId({ file, noteId }));
            }
        }
    } catch (error) {
        console.error(
            `VC: Failed to save details update for version ${versionId}. Reverting UI.`,
            error
        );
        uiService.showNotice("VC: Error, could not save version details. Reverting changes.", 5000);
        if (!shouldAbort(services, getState, { noteId })) {
            dispatch(loadHistoryForNoteId({ file, noteId }));
        }
    } finally {
        if (!shouldAbort(services, getState)) {
            dispatch(appSlice.actions.stopVersionEditing());
        }
    }
};