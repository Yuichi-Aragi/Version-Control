import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import { initializeView } from '@/state/thunks/core.thunks';
import { switchBranch } from './branch.thunk';

/**
 * Prompts the user to confirm deleting a branch.
 *
 * @param branchName - The name of the branch to delete.
 * @returns A thunk that opens the confirmation panel.
 */
export const requestDeleteBranch = (branchName: string): AppThunk => async (
    dispatch,
    getState,
    services: Services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId) return;

    const manifestManager = services.manifestManager;
    const noteManifest = await manifestManager.loadNoteManifest(state.noteId);
    
    // Race Check: Verify context after async load
    if (shouldAbort(services, getState, { noteId: state.noteId })) return;
    
    if (!noteManifest) return;

    const isLastBranch = Object.keys(noteManifest.branches).length <= 1;
    const isCurrentBranch = state.currentBranch === branchName;
    const noteName = state.file?.basename || 'this note';

    let message = `Are you sure you want to delete the branch "${branchName}"? This will permanently delete all versions and edit history associated with it.`;
    
    if (isLastBranch) {
        message = `WARNING: "${branchName}" is the only branch for "${noteName}". Deleting it will completely unregister the note from version control and delete ALL history. This action cannot be undone. Are you sure?`;
    } else if (isCurrentBranch) {
        message += ` You are currently on this branch.`;
    }

    dispatch(
        appSlice.actions.openPanel({
            type: 'confirmation',
            title: isLastBranch ? 'Delete Note History?' : 'Delete Branch?',
            message: message,
            onConfirmAction: deleteBranch(branchName),
        })
    );
};

/**
 * Deletes a branch and all its history.
 *
 * @param branchName - The name of the branch to delete.
 * @returns An async thunk that performs the delete operation.
 */
export const deleteBranch = (branchName: string): AppThunk => async (
    dispatch,
    getState,
    services: Services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    const versionManager = services.versionManager;
    const editHistoryManager = services.editHistoryManager;
    const manifestManager = services.manifestManager;
    const uiService = services.uiService;

    dispatch(appSlice.actions.setProcessing(true));
    dispatch(appSlice.actions.closePanel());

    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) throw new Error("Manifest not found.");

        const isLastBranch = Object.keys(noteManifest.branches).length <= 1;

        // 1. Delete Edit History for the branch
        await editHistoryManager.deleteBranch(noteId, branchName);

        // 2. Delete Version History (and branch entry in manifest)
        // Note: VersionManager.deleteBranch handles unregistering the note if it's the last branch
        await versionManager.deleteBranch(noteId, branchName);

        // Race Check: Verify context after async deletes
        if (shouldAbort(services, getState, { noteId })) {
             // If context changed, we don't update UI state, but operation succeeded.
             return;
        }

        if (isLastBranch) {
            // Note was unregistered
            uiService.showNotice(`Note unregistered from version control.`);
            dispatch(initializeView(undefined));
        } else {
            uiService.showNotice(`Branch "${branchName}" deleted.`);
            
            // If we deleted the current branch, switch to another one
            if (state.currentBranch === branchName) {
                // Reload manifest to get remaining branches
                const updatedManifest = await manifestManager.loadNoteManifest(noteId);
                if (updatedManifest) {
                    const remainingBranches = Object.keys(updatedManifest.branches);
                    if (remainingBranches.length > 0) {
                        const nextBranch = remainingBranches[0]!;
                        dispatch(switchBranch(nextBranch));
                    }
                }
            } else {
                // Just refresh the branch switcher UI if it was open (it's closed now by closePanel)
                // but we might want to refresh available branches in state if we were just viewing
                // We can trigger a reload of history/settings to sync state
                const updatedManifest = await manifestManager.loadNoteManifest(noteId);
                if (updatedManifest) {
                    const { file } = state;
                    if (file) {
                        const { loadHistoryForNoteId } = await import('@/state/thunks/core.thunks');
                        dispatch(loadHistoryForNoteId({ file, noteId }));
                    }
                }
            }
        }

    } catch (error) {
        console.error('VC: Failed to delete branch.', error);
        uiService.showNotice(`Failed to delete branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        dispatch(appSlice.actions.setProcessing(false));
    }
};