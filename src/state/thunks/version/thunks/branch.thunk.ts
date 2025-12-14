import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { loadEffectiveSettingsForNote, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { loadEditHistory } from '@/state/thunks/edit-history';
import { VersionManager, ManifestManager, BackgroundTaskManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
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
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        await versionManager.createBranch(noteId, newBranchName);
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
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    const { noteId, file, viewMode } = state;

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const uiService = container.get<UIService>(TYPES.UIService);

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

        if (viewMode === 'edits') {
            await dispatch(loadEditHistory(noteId));
        } else {
            await dispatch(loadHistoryForNoteId(file, noteId));
        }

        // Sync watch mode (important if switching branches changes settings like auto-save)
        const backgroundTaskManager = container.get<BackgroundTaskManager>(
            TYPES.BackgroundTaskManager
        );
        backgroundTaskManager.syncWatchMode();

        notifyBranchSwitched(uiService, newBranchName);
    } catch (error) {
        console.error('VC: Failed to switch branch.', error);
        uiService.showNotice(
            `Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`
        );

        // Attempt to reload current state to ensure consistency
        dispatch(loadHistoryForNoteId(file, noteId));
    }
    // No finally block needed to unset processing, as success actions in loadHistory/loadEditHistory set status to READY.
};
