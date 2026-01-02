import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { shouldAbort } from '@/state/utils/guards';
import { initializeView } from '@/state/thunks/core.thunks';
import { switchBranch } from './branch.thunk';
import { historyApi } from '@/state/apis/history.api';

/**
 * Prompts the user to confirm deleting a branch.
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

        await editHistoryManager.deleteBranch(noteId, branchName);
        await versionManager.deleteBranch(noteId, branchName);

        if (shouldAbort(services, getState, { noteId })) return;

        if (isLastBranch) {
            uiService.showNotice(`Note unregistered from version control.`);
            dispatch(initializeView(undefined));
        } else {
            uiService.showNotice(`Branch "${branchName}" deleted.`);
            
            // Invalidate branches to update UI
            dispatch(historyApi.util.invalidateTags([{ type: 'Branches', id: noteId }]));

            if (state.currentBranch === branchName) {
                const updatedManifest = await manifestManager.loadNoteManifest(noteId);
                if (updatedManifest) {
                    const remainingBranches = Object.keys(updatedManifest.branches);
                    if (remainingBranches.length > 0) {
                        const nextBranch = remainingBranches[0]!;
                        dispatch(switchBranch(nextBranch));
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
