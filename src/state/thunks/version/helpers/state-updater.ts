import type { Dispatch } from '@reduxjs/toolkit';
import { appSlice } from '@/state';
import type { VersionHistoryEntry } from '@/types';

/**
 * State update helpers for version thunks.
 */

/**
 * Updates the state with a newly saved version entry.
 *
 * @param dispatch - Redux dispatch function.
 * @param newVersionEntry - The new version entry to add.
 * @param noteId - The note ID for the version.
 * @param currentNoteId - The current note ID in state.
 */
export function updateStateWithNewVersion(
    dispatch: Dispatch,
    newVersionEntry: VersionHistoryEntry,
    noteId: string,
    currentNoteId: string | null
): void {
    if (currentNoteId !== noteId) {
        dispatch(appSlice.actions.updateNoteIdInState({ noteId }));
    }
    dispatch(appSlice.actions.addVersionSuccess({ newVersion: newVersionEntry }));
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

    // Update in history panel
    dispatch(appSlice.actions.updateVersionDetailsInState({ versionId, ...updatePayload }));

    // Update in timeline panel
    dispatch(appSlice.actions.updateTimelineEventInState({ versionId, ...updatePayload }));
}
