import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { loadEffectiveSettingsForNote, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { loadEditHistory } from '@/state/thunks/edit-history';
import { shouldAbort } from '@/state/utils/guards';
import { notifyBranchCreated, notifyBranchSwitched } from '../helpers';

/**
 * Creates a new branch from the current state.
 *
 * After creation, automatically switches to the new branch.
 *
 * @param newBranchName - The name of the new branch.
 * @returns An async thunk that creates and switches to the branch.
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
        
        // Race Check: Verify context after async create
        if (shouldAbort(services, getState, { noteId })) return;

        dispatch(appSlice.actions.closePanel());
        notifyBranchCreated(uiService, newBranchName);
        dispatch(switchBranch(newBranchName));
    } catch (error) {
        console.error('VC: Failed to create branch.', error);
        uiService.showNotice(
            `Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
};

/**
 * Switches to a different branch.
 *
 * This operation:
 * 1. Performs the branch switch on disk
 * 2. Invalidates caches
 * 3. Verifies the switch was successful
 * 4. Clears history state and sets loading status
 * 5. Reloads effective settings
 * 6. Reloads history for the new branch
 * 7. Syncs watch mode
 *
 * @param newBranchName - The name of the branch to switch to.
 * @returns An async thunk that performs the branch switch.
 */
export const switchBranch = (newBranchName: string): AppThunk => async (
    dispatch,
    getState,
    services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    const { noteId, file, viewMode } = state;

    const versionManager = services.versionManager;
    const manifestManager = services.manifestManager;
    const uiService = services.uiService;

    // We do NOT set isProcessing here anymore. We rely on the LOADING status set by clearHistoryForBranchSwitch.
    dispatch(appSlice.actions.closePanel());

    try {
        // 1. Perform the switch on disk
        await versionManager.switchBranch(noteId, newBranchName);

        // 2. Invalidate cache to force fresh read
        manifestManager.invalidateNoteManifestCache(noteId);

        // 3. Verify stabilization
        // We read the manifest to ensure the file system has settled and returns the expected branch.
        const manifest = await manifestManager.loadNoteManifest(noteId);
        if (!manifest || manifest.currentBranch !== newBranchName) {
            throw new Error(
                `Branch switch verification failed. Expected "${newBranchName}", got "${manifest?.currentBranch}".`
            );
        }

        // Race Check: Verify context before clearing state
        if (shouldAbort(services, getState, { noteId, filePath: file.path })) return;

        // 4. Clear state & Set Loading
        // This forces the UI to reset (show skeletons) and prevents stale state rendering.
        const availableBranches = Object.keys(manifest.branches);
        dispatch(
            appSlice.actions.clearHistoryForBranchSwitch({
                currentBranch: newBranchName,
                availableBranches,
            })
        );

        // 5. Load data for the new branch
        // We await settings first to ensure they are ready for whatever history loading needs them.
        await dispatch(loadEffectiveSettingsForNote(noteId));

        // Race Check: Verify context after settings load
        if (shouldAbort(services, getState, { noteId, filePath: file.path })) return;

        if (viewMode === 'edits') {
            await dispatch(loadEditHistory(noteId));
        } else {
            await dispatch(loadHistoryForNoteId({ file, noteId }));
        }

        // Sync watch mode (important if switching branches changes settings like auto-save)
        const backgroundTaskManager = services.backgroundTaskManager;
        backgroundTaskManager.syncWatchMode();

        notifyBranchSwitched(uiService, newBranchName);
    } catch (error) {
        console.error('VC: Failed to switch branch.', error);
        uiService.showNotice(
            `Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`
        );

        // Attempt to reload current state to ensure consistency
        if (!shouldAbort(services, getState, { noteId })) {
            dispatch(loadHistoryForNoteId({ file, noteId }));
        }
    }
    // No finally block needed to unset processing, as success actions in loadHistory/loadEditHistory set status to READY.
};