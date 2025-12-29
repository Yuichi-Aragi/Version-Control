import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { shouldAbort } from '@/state/utils/guards';

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
    services: Services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
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
    services: Services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    const uiService = services.uiService;

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice('Cannot view version: context not ready.');
        return;
    }

    const { noteId, viewMode } = state;
    let content: string | null = null;

    dispatch(appSlice.actions.setProcessing(true));

    try {
        if (viewMode === 'versions') {
            const versionManager = services.versionManager;
            content = await versionManager.getVersionContent(noteId, version.id);
        } else {
            const editHistoryManager = services.editHistoryManager;
            content = await editHistoryManager.getEditContent(noteId, version.id);
        }

        if (content === null) {
            throw new Error('Content not found.');
        }

        // Race Check: Verify context after async content load
        if (shouldAbort(services, getState, { noteId })) {
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
        if (!shouldAbort(services, getState)) {
            dispatch(appSlice.actions.setProcessing(false));
        }
    }
};