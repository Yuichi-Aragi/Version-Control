/**
 * Save Edit Thunk
 *
 * Handles saving new edits for a note
 */

import { App, TFile } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager, NoteManager, ManifestManager, BackgroundTaskManager, TimelineManager, PluginEvents } from '@/core';
import { UIService } from '@/services';
import { isPluginUnloading, resolveSettings } from '@/state/utils/settingsUtils';
import { loadHistoryForNoteId } from '../../core.thunks';

/**
 * Saves a new edit for the current note
 *
 * @param isAuto - Whether this is an auto-save operation
 * @returns AppThunk that saves the new edit
 */
export const saveNewEdit =
    (isAuto = false): AppThunk =>
    async (dispatch, getState, container) => {
        if (isPluginUnloading(container)) return;

        const state = getState();
        const uiService = container.get<UIService>(TYPES.UIService);
        const app = container.get<App>(TYPES.App);
        const editHistoryManager =
            container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        const noteManager = container.get<NoteManager>(TYPES.NoteManager);
        const manifestManager =
            container.get<ManifestManager>(TYPES.ManifestManager);
        const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
        const timelineManager = container.get<TimelineManager>(TYPES.TimelineManager);
        const eventBus = container.get<PluginEvents>(TYPES.EventBus);

        if (state.status !== AppStatus.READY && !isAuto) {
            // Allow if we are in a state where we can initialize (e.g. valid file but no ID)
            if (!state.file) return;
        }

        const file = state.file;
        if (!file) return;

        dispatch(appSlice.actions.setProcessing(true));

        try {
            // Read active content
            const liveFile = app.vault.getAbstractFileByPath(file.path);
            if (!(liveFile instanceof TFile))
                throw new Error('File not found');

            let noteId = state.noteId;

            // Initialization logic if noteId is missing (First Edit)
            if (!noteId) {
                noteId = await noteManager.getOrCreateNoteId(liveFile);
                if (!noteId) throw new Error('Could not generate Note ID');

                // Ensure manifest exists (Version Manager usually does this, but we are in Edit mode)
                let noteManifest =
                    await manifestManager.loadNoteManifest(noteId);
                if (!noteManifest) {
                    noteManifest = await manifestManager.createNoteEntry(
                        noteId,
                        liveFile.path
                    );
                }

                // Update state with new ID
                dispatch(appSlice.actions.updateNoteIdInState({ noteId }));

                // Also need to ensure we have the version history loaded/initialized structure in state
                // so UI doesn't break
                dispatch(loadHistoryForNoteId(liveFile, noteId));
            }

            // Use adapter read to support both .md and .base files uniformly as text.
            const content = await app.vault.adapter.read(liveFile.path);

            // Resolve settings for max versions
            const settings = await resolveSettings(noteId, 'edit', container);
            const maxVersions = settings.maxVersionsPerNote;

            // Delegate all logic to Manager to ensure serialization and atomicity
            const result = await editHistoryManager.createEdit(
                noteId,
                content,
                file.path,
                maxVersions
            );

            if (result) {
                const { entry: newEditEntry, deletedIds } = result;

                // Update State - Add New
                dispatch(appSlice.actions.addEditSuccess({ newEdit: newEditEntry }));

                // Update State - Remove Old (Instant UI Update)
                if (deletedIds.length > 0) {
                    dispatch(appSlice.actions.removeEditsSuccess({ ids: deletedIds }));
                    
                    // Update Timeline if needed
                    if (getState().panel?.type === 'timeline' && getState().viewMode === 'edits') {
                         for (const id of deletedIds) {
                            dispatch(appSlice.actions.removeTimelineEvent({ versionId: id }));
                         }
                    }
                }
                
                // Trigger Event Bus for external subscribers (Instant UI Updates)
                eventBus.trigger('version-saved', noteId);
                
                // Instant Timeline Update for New Event
                const currentState = getState();
                if (currentState.panel?.type === 'timeline' && currentState.viewMode === 'edits') {
                    try {
                        const newEvent = await timelineManager.createEventForNewVersion(
                            noteId,
                            currentState.currentBranch || 'main',
                            'edit',
                            newEditEntry
                        );
                        if (newEvent) {
                            dispatch(appSlice.actions.addTimelineEvent(newEvent));
                        }
                    } catch (timelineError) {
                        console.error('VC: Failed to update timeline instantly', timelineError);
                        // Non-critical, timeline will refresh on next load
                    }
                }

                if (!isAuto) {
                    uiService.showNotice(`Edit #${newEditEntry.versionNumber} saved.`);
                    // If manual save, reset the timer to skip the next immediate auto-save turn
                    backgroundTaskManager.resetTimer('edit');
                }
            } else {
                // Duplicate content case
                if (!isAuto) {
                    uiService.showNotice('No changes detected since last edit.');
                }
            }

        } catch (error) {
            console.error('VC: Failed to save edit', error);
            if (!isAuto) uiService.showNotice('Failed to save edit.');
        } finally {
            if (!isPluginUnloading(container)) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    };
