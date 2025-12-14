import { TFile, App } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { initializeView, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { VersionManager, NoteManager, BackgroundTaskManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading, resolveSettings } from '@/state/utils/settingsUtils';
import type VersionControlPlugin from '@/main';
import { validateNotRenaming, validateNoteContext } from '../validation';
import {
    handleVersionErrorWithMessage,
    notifyRestoreSuccess,
    notifyRestoreCancelled,
} from '../helpers';

/**
 * Prompts the user to confirm restoring a version.
 *
 * Opens a confirmation panel that explains the restore operation will create
 * a backup before overwriting the current content.
 *
 * @param version - The version to restore.
 * @returns A thunk that opens the confirmation panel.
 */
export const requestRestore = (version: VersionHistoryEntry): AppThunk => (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status !== AppStatus.READY) return;

    const file = state.file;
    if (!file) return;

    const versionLabel = version.name
        ? `"${version.name}" (V${version.versionNumber})`
        : `Version ${version.versionNumber}`;

    dispatch(
        appSlice.actions.openPanel({
            type: 'confirmation',
            title: 'Confirm restore',
            message: `This will overwrite the current content of "${file.basename}" with ${versionLabel}. A backup of the current content will be saved as a new version before restoring. Are you sure?`,
            onConfirmAction: restoreVersion(version.id),
        })
    );
};

/**
 * Restores a version by creating a backup of current content and then
 * overwriting the file with the version's content.
 *
 * @param versionId - The ID of the version to restore.
 * @returns An async thunk that performs the restore operation.
 */
export const restoreVersion = (versionId: string): AppThunk => async (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();

    // Validate not renaming
    if (!validateNotRenaming(initialState.isRenaming, uiService, 'restore version')) {
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

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
        const liveFile = container
            .get<App>(TYPES.App)
            .vault.getAbstractFileByPath(file.path);
        if (!(liveFile instanceof TFile)) {
            throw new Error(
                `Restore failed. Note "${file.basename}" may have been deleted or moved.`
            );
        }

        const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
        if (currentNoteIdOnDisk !== noteId) {
            throw new Error(
                `Restore failed. Note's version control ID has changed or was removed. Expected "${noteId}", found "${currentNoteIdOnDisk}".`
            );
        }

        // Resolve effective settings properly to respect local overrides
        const historySettings = await resolveSettings(noteId, 'version', container);
        const hybridSettings = {
            ...plugin.settings,
            ...historySettings,
        };

        await versionManager.saveNewVersionForFile(liveFile, {
            name: `Backup before restoring V${versionId.substring(0, 6)}...`,
            force: true,
            isAuto: false,
            settings: hybridSettings,
        });

        const stateAfterBackup = getState();
        if (
            isPluginUnloading(container) ||
            stateAfterBackup.status !== AppStatus.READY ||
            stateAfterBackup.noteId !== noteId
        ) {
            notifyRestoreCancelled(uiService);
            if (!isPluginUnloading(container)) {
                dispatch(initializeView());
            }
            return;
        }

        const restoreSuccess = await versionManager.restoreVersion(
            liveFile,
            noteId,
            versionId
        );

        if (restoreSuccess) {
            notifyRestoreSuccess(uiService, liveFile, versionId);
        }
        dispatch(loadHistoryForNoteId(liveFile, noteId));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        handleVersionErrorWithMessage(
            error,
            'restoreVersion',
            `Restore failed: ${message}`,
            uiService,
            7000
        );
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
        }
    }
};
