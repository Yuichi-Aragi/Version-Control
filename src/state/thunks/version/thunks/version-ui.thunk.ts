import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { VersionManager } from '@/core';
import { UIService } from '@/services';
import { TYPES } from '@/types/inversify.types';
import { isPluginUnloading } from '@/state/utils/settingsUtils';

/**
 * Requests to edit a version's name and description.
 *
 * This closes any existing panel and opens the version editing form.
 *
 * @param version - The version to edit.
 * @returns A thunk that starts version editing.
 */
export const requestEditVersion = (version: VersionHistoryEntry): AppThunk => (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    if (state.status !== AppStatus.READY) return;

    // This action does not open a new panel, so we must explicitly close the current one first.
    dispatch(appSlice.actions.closePanel());
    dispatch(appSlice.actions.startVersionEditing({ versionId: version.id }));
};

/**
 * Views a version's content in a preview panel.
 *
 * Loads the content from the appropriate manager (version or edit) and
 * displays it in a preview panel.
 *
 * @param version - The version to view.
 * @returns An async thunk that loads and displays the version content.
 */
export const viewVersionInPanel = (version: VersionHistoryEntry): AppThunk => async (
    dispatch,
    getState,
    container
) => {
    if (isPluginUnloading(container)) return;

    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice('Cannot view version: context not ready.');
        return;
    }

    const { noteId, viewMode } = state;
    let content: string | null = null;

    dispatch(appSlice.actions.setProcessing(true));

    try {
        if (viewMode === 'versions') {
            const versionManager = container.get<VersionManager>(TYPES.VersionManager);
            content = await versionManager.getVersionContent(noteId, version.id);
        } else {
            // We need to dynamically import or use container to get EditHistoryManager to avoid circular imports if any
            // But since we are in thunks, we can just use container.
            // Note: EditHistoryManager type is needed.
            const { EditHistoryManager } = require('../../../../core/edit-history-manager');
            const editHistoryManager = container.get<typeof EditHistoryManager>(
                TYPES.EditHistoryManager
            );
            content = await editHistoryManager.getEditContent(noteId, version.id);
        }

        if (content === null) {
            throw new Error('Content not found.');
        }

        // Check if state is still valid for this note before opening panel
        const currentState = getState();
        if (currentState.noteId !== noteId) {
            console.warn('VC: Note ID changed during preview load. Aborting panel open.');
            return;
        }

        dispatch(
            appSlice.actions.openPanel({
                type: 'preview',
                version,
                content,
            })
        );
    } catch (error) {
        console.error('VC: Failed to view version content.', error);
        uiService.showNotice('Failed to load content for preview.');
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(appSlice.actions.setProcessing(false));
        }
    }
};
