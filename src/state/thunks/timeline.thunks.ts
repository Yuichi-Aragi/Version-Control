import type { AppThunk } from '@/state';
import { appSlice } from '@/state';
import { AppStatus } from '@/state';
import { shouldAbort } from '@/state/utils/guards';

/**
 * Thunks related to the Timeline feature.
 */

export const openTimeline = (): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    const uiService = services.uiService;

    if (state.status !== AppStatus.READY || !state.noteId || !state.currentBranch) {
        uiService.showNotice("Cannot open timeline: view context is not ready.");
        return;
    }

    // Open the panel in timeline mode. Data loading is now handled by the UI component via RTK Query.
    dispatch(appSlice.actions.openPanel({ type: 'timeline' }));
};
