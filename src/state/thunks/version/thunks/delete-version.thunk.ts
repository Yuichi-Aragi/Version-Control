import { TFile, App } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { initializeView, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { deleteAllEdits } from '@/state/thunks/edit-history';
import { VersionManager, NoteManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import { validateNotRenaming, validateNoteContext } from '../validation';
import {
    handleVersionErrorWithMessage,
    notifyDeleteSuccess,
    notifyDeleteInBackground,
} from '../helpers';

/**
 * Prompts the user to confirm deleting a version.
 *
 * Opens a confirmation panel with a warning message.
 *
 * @param version - The version to delete.
 * @returns A thunk that opens the confirmation panel.
 */
export const requestDelete = (version: VersionHistoryEntry): AppThunk => (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status === AppStatus.READY) {
        const { file } = state;
        if (!file) return;

        const versionLabel = version.name
            ? `"${version.name}" (V${version.versionNumber})`
            : `Version ${version.versionNumber}`;
        
        const message = `Are you sure you want to permanently delete ${versionLabel} for "${file.basename}"? This action cannot be undone.`;

        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm delete',
                message: message,
                onConfirmAction: deleteVersion(version.id),
            })
        );
    }
};

/**
 * Deletes a version from the history.
 *
 * @param versionId - The ID of the version to delete.
 * @returns An async thunk that performs the delete operation.
 */
export const deleteVersion = (versionId: string): AppThunk => async (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();

    // Validate not renaming
    if (!validateNotRenaming(initialState.isRenaming, uiService, 'delete version')) {
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const app = container.get<App>(TYPES.App);

    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) return;

    // At this point, we know both are non-null (validated above)
    const file = initialFileFromState!;
    const noteId = initialNoteIdFromState!;

    dispatch(appSlice.actions.setProcessing(true));
    dispatch(appSlice.actions.closePanel());

    try {
        const liveFile = app.vault.getAbstractFileByPath(file.path);
        if (liveFile instanceof TFile) {
            const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
            if (
                currentNoteIdOnDisk !== noteId &&
                currentNoteIdOnDisk !== null
            ) {
                throw new Error(
                    `Delete failed. Note's version control ID has changed. Expected "${noteId}", found "${currentNoteIdOnDisk}".`
                );
            }
        }

        const success = await versionManager.deleteVersion(noteId, versionId);

        const stateAfterDelete = getState();
        if (
            isPluginUnloading(container) ||
            stateAfterDelete.file?.path !== file.path
        ) {
            if (success) {
                notifyDeleteInBackground(uiService, file.basename);
            }
            return;
        }

        if (success) {
            dispatch(loadHistoryForNoteId(file, noteId));
            notifyDeleteSuccess(uiService, versionId);
        } else {
            throw new Error(`Failed to delete version ${versionId.substring(0, 6)}...`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        handleVersionErrorWithMessage(
            error,
            'deleteVersion',
            `Delete failed: ${message}`,
            uiService,
            7000
        );
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    }
};

/**
 * Prompts the user to confirm deleting all versions/edits in the current branch
 * based on the active view mode.
 *
 * @returns A thunk that opens the confirmation panel.
 */
export const requestDeleteAll = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status === AppStatus.READY) {
        const { file, currentBranch, viewMode } = state;
        if (!file || !currentBranch) return;

        const basename = file.basename;
        const typeLabel = viewMode === 'versions' ? 'version history' : 'edit history';
        const action = viewMode === 'versions' ? deleteAllVersions() : deleteAllEdits();

        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: `Delete all ${typeLabel}?`,
                message: `This will permanently delete all ${typeLabel} for the branch "${currentBranch}" of note "${basename}". This action cannot be undone. Are you sure?`,
                onConfirmAction: action,
            })
        );
    }
};

/**
 * Deletes all versions in the current branch.
 *
 * @returns An async thunk that performs the delete all operation.
 */
export const deleteAllVersions = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;

    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();

    // Validate not renaming
    if (!validateNotRenaming(initialState.isRenaming, uiService, 'delete history')) {
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) return;

    // At this point, we know both are non-null (validated above)
    const file = initialFileFromState!;
    const noteId = initialNoteIdFromState!;

    dispatch(appSlice.actions.setProcessing(true));
    dispatch(appSlice.actions.closePanel());

    try {
        const success = await versionManager.deleteAllVersionsInCurrentBranch(noteId);

        if (
            isPluginUnloading(container) ||
            getState().file?.path !== file.path
        ) {
            if (success) {
                const { notifyDeleteAllInBackground } = await import('../helpers');
                notifyDeleteAllInBackground(uiService, file.basename);
            }
            return;
        }

        if (success) {
            const { notifyDeleteAllSuccess } = await import('../helpers');
            notifyDeleteAllSuccess(uiService, file.basename);
            dispatch(initializeView());
        } else {
            throw new Error(`Failed to delete all versions for "${file.basename}".`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        handleVersionErrorWithMessage(
            error,
            'deleteAllVersions',
            `Delete all failed: ${message}`,
            uiService,
            7000
        );
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    }
};
