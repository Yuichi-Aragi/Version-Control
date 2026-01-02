import { appSlice } from '@/state/appSlice';
import type { AppThunk } from '@/state/store';
import type { VersionHistoryEntry } from '@/types';
import { shouldAbort } from '@/state/utils/guards';

/**
 * Opens the preview panel for a specific version.
 * Content fetching is now handled by the UI component via RTK Query.
 */
export const viewVersionInPanel = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    dispatch(appSlice.actions.openPanel({
        type: 'preview',
        version
    }));
};

/**
 * Alias for viewVersionInPanel.
 */
export const openVersionPreview = viewVersionInPanel;

/**
 * Requests to edit a version's details (name/description).
 * Triggers the inline editor in the UI.
 */
export const requestEditVersion = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    // Close any open panel (like the context menu that triggered this)
    dispatch(appSlice.actions.closePanel());
    
    dispatch(appSlice.actions.startVersionEditing({ versionId: version.id }));
};
