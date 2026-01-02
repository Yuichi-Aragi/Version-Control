import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { loadEffectiveSettingsForNote } from '@/state/thunks/core.thunks';
import { shouldAbort } from '@/state/utils/guards';
import { notifyBranchCreated, notifyBranchSwitched } from '../helpers';
import { historyApi } from '@/state/apis/history.api';

/**
 * Creates a new branch from the current state.
 */
export const createBranch = (newBranchName: string): AppThunk => async (
    dispatch,
    getState,
    services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    const versionManager = services.versionManager;
    const uiService = services.uiService;

    try {
        await versionManager.createBranch(noteId, newBranchName);
        
        if (shouldAbort(services, getState, { noteId })) return;

        dispatch(appSlice.actions.closePanel());
        notifyBranchCreated(uiService, newBranchName);
        dispatch(switchBranch(newBranchName));
        
        // Invalidate branches tag
        dispatch(historyApi.util.invalidateTags([{ type: 'Branches', id: noteId }]));
    } catch (error) {
        console.error('VC: Failed to create branch.', error);
        uiService.showNotice(
            `Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
};

/**
 * Switches to a different branch.
 */
export const switchBranch = (newBranchName: string): AppThunk => async (
    dispatch,
    getState,
    services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    const { noteId, file } = state;

    const versionManager = services.versionManager;
    const manifestManager = services.manifestManager;
    const uiService = services.uiService;

    dispatch(appSlice.actions.closePanel());

    try {
        await versionManager.switchBranch(noteId, newBranchName);
        manifestManager.invalidateNoteManifestCache(noteId);

        const manifest = await manifestManager.loadNoteManifest(noteId);
        if (!manifest || manifest.currentBranch !== newBranchName) {
            throw new Error(
                `Branch switch verification failed. Expected "${newBranchName}", got "${manifest?.currentBranch}".`
            );
        }

        if (shouldAbort(services, getState, { noteId, filePath: file.path })) return;

        await dispatch(loadEffectiveSettingsForNote(noteId));

        if (shouldAbort(services, getState, { noteId, filePath: file.path })) return;

        // Force refresh of all data for this note
        dispatch(historyApi.util.invalidateTags([
            { type: 'VersionHistory', id: noteId },
            { type: 'EditHistory', id: noteId },
            { type: 'Branches', id: noteId }
        ]));

        const backgroundTaskManager = services.backgroundTaskManager;
        backgroundTaskManager.syncWatchMode();

        notifyBranchSwitched(uiService, newBranchName);
    } catch (error) {
        console.error('VC: Failed to switch branch.', error);
        uiService.showNotice(
            `Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        // Force refresh to restore UI state
        dispatch(historyApi.util.invalidateTags([{ type: 'VersionHistory', id: noteId }]));
    }
};
