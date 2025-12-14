/**
 * Restore Edit Thunk
 *
 * Handles restoring edits and related confirmation dialogs
 */

import { App, TFile } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager, NoteManager } from '@/core';
import { UIService } from '@/services';
import { isPluginUnloading } from '@/state/utils/settingsUtils';

/**
 * Restores an edit to the current note
 *
 * @param editId - The edit ID to restore
 * @returns AppThunk that restores the edit
 */
export const restoreEdit =
    (editId: string): AppThunk =>
    async (dispatch, getState, container) => {
        if (isPluginUnloading(container)) return;

        const state = getState();
        const editHistoryManager =
            container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        const noteManager = container.get<NoteManager>(TYPES.NoteManager);
        const uiService = container.get<UIService>(TYPES.UIService);
        const app = container.get<App>(TYPES.App);

        if (state.status !== AppStatus.READY || !state.noteId || !state.file)
            return;
        const { noteId, file, currentBranch } = state;

        dispatch(appSlice.actions.setProcessing(true));
        dispatch(appSlice.actions.closePanel());

        try {
            const content = await editHistoryManager.getEditContent(
                noteId,
                editId,
                currentBranch!
            );
            if (content === null) throw new Error('Content not found');

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
        } catch (error) {
            console.error('VC: Failed to restore edit', error);
            uiService.showNotice('Failed to restore edit.');
        } finally {
            if (!isPluginUnloading(container)) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    };

/**
 * Opens a confirmation dialog before restoring an edit
 *
 * @param edit - The edit entry to restore
 * @returns AppThunk that opens the confirmation dialog
 */
export const requestRestoreEdit =
    (edit: VersionHistoryEntry): AppThunk =>
    (dispatch, _getState, _container) => {
        dispatch(
            appSlice.actions.openPanel({
                type: 'confirmation',
                title: 'Confirm restore edit',
                message: `Overwrite current note with this edit?`,
                onConfirmAction: restoreEdit(edit.id),
            })
        );
    };
