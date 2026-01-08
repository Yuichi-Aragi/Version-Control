import * as v from 'valibot';
import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import type { UpdateVersionDetailsPayload } from '../types';
import { UpdateVersionDetailsPayloadSchema } from '@/state/thunks/schemas';
import { validateNotRenaming, validateNoteContext } from '@/state/utils/thunk-validation';
import { historyApi } from '@/state/apis/history.api';

/**
 * Updates the name and description of a version.
 */
export const updateVersionDetails = (
    versionId: string,
    details: UpdateVersionDetailsPayload
): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;

    try {
        v.parse(UpdateVersionDetailsPayloadSchema, details);
    } catch (validationError) {
        console.error("Version Control: Invalid UpdateVersionDetailsPayload", validationError);
        return;
    }

    const uiService = services.uiService;
    const state = getState().app;

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

    const noteId = initialNoteId!;

    const updatePayload = {
        name: details.name.trim(),
        description: details.description.trim(),
    };

    try {
        await versionManager.updateVersionDetails(
            noteId,
            versionId,
            updatePayload
        );

        const eventBus = services.eventBus;
        eventBus.trigger('version-updated', noteId, versionId, updatePayload);

        // Invalidate to refresh list and timeline
        dispatch(historyApi.util.invalidateTags([
            { type: 'VersionHistory', id: noteId },
            { type: 'Timeline', id: noteId }
        ]));

    } catch (error) {
        console.error(
            `VC: Failed to save details update for version ${versionId}.`,
            error
        );
        uiService.showNotice("VC: Error, could not save version details.", 5000);
        // Ensure UI is consistent
        dispatch(historyApi.util.invalidateTags([{ type: 'VersionHistory', id: noteId }]));
    } finally {
        if (!shouldAbort(services, getState)) {
            dispatch(appSlice.actions.stopVersionEditing());
        }
    }
};
