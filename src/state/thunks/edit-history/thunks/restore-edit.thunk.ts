/**
 * Restore Edit Thunk
 *
 * Handles restoring edits and related confirmation dialogs
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import { validateReadyState, validateNoteContext } from '@/state/utils/thunk-validation';

/**
 * Restores an edit to the current note
 */
export const restoreEdit = createAsyncThunk<
    void,
    string,
    ThunkConfig
>(
    'editHistory/restoreEdit',
    async (editId, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const state = getState().app;
        const editHistoryManager = services.editHistoryManager;
        const noteManager = services.noteManager;
        const uiService = services.uiService;
        const app = services.app;

        if (!validateReadyState(state, uiService)) return rejectWithValue('Not ready');
        if (!validateNoteContext(state.noteId, state.file)) return rejectWithValue('Invalid context');

        // validateNoteContext ensures noteId is not null, but we must assert it for TS
        const noteId = state.noteId!;
        const { file, currentBranch } = state;

        dispatch(appSlice.actions.closePanel());

        try {
            const content = await editHistoryManager.getEditContent(
                noteId,
                editId,
                currentBranch!
            );
            if (content === null) throw new Error('Content not found');

            // Race Check: Verify context after content load
            if (shouldAbort(services, getState, { noteId, filePath: file.path })) return rejectWithValue('Context changed');

            const liveFile = app.vault.getAbstractFileByPath(file.path);
            if (liveFile instanceof TFile) {
                await app.vault.modify(liveFile, content);
                
                if (liveFile.extension === 'md') {
                    // Ensure the noteId is preserved in the frontmatter after restoration.
                    await noteManager.writeNoteIdToFrontmatter(liveFile, noteId);
                }

                uiService.showNotice(
                    `Restored Edit #${editId.substring(0, 6)}...`
                );
            }
            return;
        } catch (error) {
            console.error('VC: Failed to restore edit', error);
            uiService.showNotice('Failed to restore edit.');
            return rejectWithValue(String(error));
        }
    }
);

/**
 * Opens a confirmation dialog before restoring an edit
 *
 * @param edit - The edit entry to restore
 * @returns AppThunk that opens the confirmation dialog
 */
export const requestRestoreEdit =
    (edit: VersionHistoryEntry): AppThunk =>
    (dispatch, _getState, _services) => {
        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm restore edit',
                message: `Overwrite current note with this edit?`,
                onConfirmAction: restoreEdit(edit.id),
            })
        );
    };
