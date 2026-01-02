import type { Dispatch } from '@reduxjs/toolkit';
import { appSlice } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { historyApi } from '@/state/apis/history.api';

/**
 * State update helpers for version thunks.
 */

/**
 * Updates the state with a newly saved version entry.
 *
 * @param dispatch - Redux dispatch function.
 * @param _newVersionEntry - The new version entry (unused as we invalidate tags).
 * @param noteId - The note ID for the version.
 * @param currentNoteId - The current note ID in state.
 */
export function updateStateWithNewVersion(
    dispatch: Dispatch,
    _newVersionEntry: VersionHistoryEntry,
    noteId: string,
    currentNoteId: string | null
): void {
    if (currentNoteId !== noteId) {
        dispatch(appSlice.actions.updateNoteIdInState({ noteId }));
    }
    
    // Invalidate tags to trigger RTK Query refetch
    dispatch(historyApi.util.invalidateTags([
        { type: 'VersionHistory', id: noteId },
        { type: 'Branches', id: noteId }
    ]));
}

/**
 * Updates version details in both history and timeline.
 *
 * @param dispatch - Redux dispatch function.
 * @param versionId - The ID of the version to update.
 * @param name - The new name.
 * @param description - The new description.
 */
export function updateVersionDetailsInState(
    dispatch: Dispatch,
    versionId: string,
    name: string,
    description: string
): void {
    const updatePayload = { name, description };

    // Update in timeline panel (optimistic)
    dispatch(appSlice.actions.updateTimelineEventInState({ versionId, ...updatePayload }));
}
