import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { appSlice, AppStatus } from '@/state';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { shouldAbort } from '@/state/utils/guards';
import { loadHistoryForNoteId } from '@/state/thunks/core.thunks';
import type { ThunkConfig } from '@/state/store';
import type { VersionHistoryEntry } from '@/types';

/**
 * Saves a new edit for the current note.
 */
export const saveNewEdit = createAsyncThunk<
    { newEditEntry: VersionHistoryEntry; deletedIds: string[] } | null,
    boolean | undefined,
    ThunkConfig
>(
    'editHistory/saveNewEdit',
    async (isAuto = false, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const state = getState().app;
        const uiService = services.uiService;
        const app = services.app;
        const editHistoryManager = services.editHistoryManager;
        const noteManager = services.noteManager;
        const manifestManager = services.manifestManager;
        const backgroundTaskManager = services.backgroundTaskManager;
        const timelineManager = services.timelineManager;
        const eventBus = services.eventBus;

        if (state.status !== AppStatus.READY && !isAuto) {
            if (!state.file) return rejectWithValue('No file');
        }

        const file = state.file;
        if (!file) return rejectWithValue('No file');

        try {
            const liveFile = app.vault.getAbstractFileByPath(file.path);
            if (!(liveFile instanceof TFile)) throw new Error('File not found');

            let noteId = state.noteId;

            // Initialization logic if noteId is missing (First Edit)
            if (!noteId) {
                noteId = await noteManager.getOrCreateNoteId(liveFile);
                if (!noteId) throw new Error('Could not generate Note ID');

                let noteManifest = await manifestManager.loadNoteManifest(noteId);
                if (!noteManifest) {
                    noteManifest = await manifestManager.createNoteEntry(
                        noteId,
                        liveFile.path
                    );
                }

                dispatch(appSlice.actions.updateNoteIdInState({ noteId }));
                dispatch(loadHistoryForNoteId({ file: liveFile, noteId }));
            }

            const content = await app.vault.adapter.read(liveFile.path);
            const settings = await resolveSettings(noteId, 'edit', services);
            const maxVersions = settings.maxVersionsPerNote;
            const currentBranch = state.currentBranch || 'main';

            const result = await editHistoryManager.createEdit(
                noteId,
                currentBranch,
                content,
                file.path,
                maxVersions
            );

            // Race Check
            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            if (result) {
                const { entry: newEditEntry, deletedIds } = result;

                // Trigger Event Bus
                eventBus.trigger('version-saved', noteId);
                
                // Instant Timeline Update
                const currentState = getState().app;
                if (currentState.panel?.type === 'timeline' && currentState.viewMode === 'edits') {
                    try {
                        const newEvent = await timelineManager.createEventForNewVersion(
                            noteId,
                            currentBranch,
                            'edit',
                            newEditEntry
                        );
                        if (newEvent) {
                            dispatch(appSlice.actions.addTimelineEvent(newEvent));
                        }
                    } catch (timelineError) {
                        console.error('VC: Failed to update timeline instantly', timelineError);
                    }
                }

                if (!isAuto) {
                    uiService.showNotice(`Edit #${newEditEntry.versionNumber} saved.`);
                    backgroundTaskManager.resetTimer('edit');
                }

                return { newEditEntry, deletedIds };
            } else {
                if (!isAuto) {
                    uiService.showNotice('No changes detected since last edit.');
                }
                return null;
            }

        } catch (error) {
            console.error('VC: Failed to save edit', error);
            if (!isAuto) uiService.showNotice('Failed to save edit.');
            return rejectWithValue(String(error));
        }
    }
);