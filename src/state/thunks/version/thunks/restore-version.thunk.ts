import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { initializeView, loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { validateNotRenaming, validateNoteContext } from '../validation';
import {
    handleVersionErrorWithMessage,
    notifyRestoreSuccess,
    notifyRestoreCancelled,
} from '../helpers';

/**
 * Prompts the user to confirm restoring a version.
 */
export const requestRestore = (version: VersionHistoryEntry): any => (
    dispatch: any,
    getState: any,
    services: any
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
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
 */
export const restoreVersion = createAsyncThunk<
    void,
    string,
    ThunkConfig
>(
    'version/restoreVersion',
    async (versionId, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const uiService = services.uiService;
        const initialState = getState().app;

        if (!validateNotRenaming(initialState.isRenaming, uiService, 'restore version')) {
            return rejectWithValue('Renaming in progress');
        }

        const versionManager = services.versionManager;
        const noteManager = services.noteManager;
        const backgroundTaskManager = services.backgroundTaskManager;
        const plugin = services.plugin;

        if (initialState.status !== AppStatus.READY) return rejectWithValue('Not ready');

        const initialFileFromState = initialState.file;
        const initialNoteIdFromState = initialState.noteId;
        if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) return rejectWithValue('Invalid context');

        const file = initialFileFromState!;
        const noteId = initialNoteIdFromState!;

        // Close panel explicitly as this is a UI interaction
        dispatch(appSlice.actions.closePanel());

        try {
            const liveFile = services.app.vault.getAbstractFileByPath(file.path);
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

            const historySettings = await resolveSettings(noteId, 'version', services);
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

            // Race Check
            if (shouldAbort(services, getState, { noteId, status: AppStatus.READY })) {
                notifyRestoreCancelled(uiService);
                if (!shouldAbort(services, getState)) {
                    dispatch(initializeView(undefined));
                }
                return rejectWithValue('Context changed');
            }

            const restoreSuccess = await versionManager.restoreVersion(
                liveFile,
                noteId,
                versionId
            );

            if (restoreSuccess) {
                notifyRestoreSuccess(uiService, liveFile, versionId);
            }
            // STRICT: Await load so we can sync watch mode after state is READY
            await dispatch(loadHistoryForNoteId({ file: liveFile, noteId }));
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
            handleVersionErrorWithMessage(
                error,
                'restoreVersion',
                `Restore failed: ${message}`,
                uiService,
                7000
            );
            if (!shouldAbort(services, getState)) {
                dispatch(initializeView(undefined));
            }
            return rejectWithValue(message);
        } finally {
            if (!shouldAbort(services, getState)) {
                backgroundTaskManager.syncWatchMode();
            }
        }
    }
);
