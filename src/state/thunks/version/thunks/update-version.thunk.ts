import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { VersionManager } from '@/core';
import { PluginEvents } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import type { UpdateVersionDetailsPayload } from '../types';
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
): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    // Validate not renaming
    if (!validateNotRenaming(state.isRenaming, uiService, 'edit version')) {
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

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
        const eventBus = container.get<PluginEvents>(TYPES.EventBus);
        eventBus.trigger('version-updated', noteId, versionId, updatePayload);

        // If the ID changed due to renaming, we must reload the history to reflect the new ID in the state
        if (newVersionId !== versionId) {
            if (!isPluginUnloading(container)) {
                dispatch(loadHistoryForNoteId(file, noteId));
            }
        }
    } catch (error) {
        console.error(
            `VC: Failed to save details update for version ${versionId}. Reverting UI.`,
            error
        );
        uiService.showNotice("VC: Error, could not save version details. Reverting changes.", 5000);
        if (!isPluginUnloading(container)) {
            dispatch(loadHistoryForNoteId(file, noteId));
        }
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(appSlice.actions.stopVersionEditing());
        }
    }
};
