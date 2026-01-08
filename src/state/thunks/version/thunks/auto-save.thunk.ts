import { TFile } from 'obsidian';
import type { AppThunk, Services } from '@/state';
import { AppStatus } from '@/state';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { shouldAbort } from '@/state/utils/guards';
import { updateStateWithNewVersion } from '../helpers';
import { saveNewVersion } from './save-version.thunk';

/**
 * Performs an automatic save for a file.
 *
 * This is triggered by vault events (like file save) and uses the file's
 * effective settings to determine save behavior. It's a silent operation
 * that doesn't show user notifications.
 *
 * @param file - The file to auto-save.
 * @returns An async thunk that performs the auto-save operation.
 */
export const performAutoSave = (file: TFile): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;

    const noteManager = services.noteManager;
    // GUARD: Check for pending deviation to prevent auto-save race conditions
    if (noteManager.isPendingDeviation(file.path)) {
        return;
    }

    const state = getState().app;
    if (state.isRenaming) {
        return; // Silently ignore auto-saves during rename
    }

    const manifestManager = services.manifestManager;
    const plugin = services.plugin;

    const noteId =
        (await noteManager.getNoteId(file)) ?? (await manifestManager.getNoteIdByPath(file.path));
    if (!noteId) return;

    // Resolve effective settings properly to respect local overrides
    const historySettings = await resolveSettings(noteId, 'version', services);
    const hybridSettings = {
        ...plugin.settings,
        ...historySettings,
    };

    // Note: isAuto=true implies allowInit=false, preventing creation of history if it doesn't exist
    const resultAction = await dispatch(saveNewVersion({
        name: 'Auto-save',
        force: false,
        isAuto: true,
        settings: hybridSettings,
    }));

    if (saveNewVersion.fulfilled.match(resultAction)) {
        const result = resultAction.payload;
        if (result && result.status === 'saved' && result.newVersionEntry) {
            const currentState = getState().app;
            // Only update state if we are still viewing the file that was auto-saved
            if (currentState.status === AppStatus.READY && currentState.file?.path === file.path && currentState.noteId === noteId) {
                updateStateWithNewVersion(
                    dispatch,
                    result.newVersionEntry,
                    result.newNoteId,
                    currentState.noteId
                );
            }
        }
    }
};
