import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { appSlice } from '@/state';
import { resolveSettings } from '@/state/utils/settingsUtils';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import type { VersionHistoryEntry } from '@/types';
import { historyApi } from '@/state/apis/history.api';
import { validateReadyState, validateFileExists } from '@/state/utils/thunk-validation';

export interface SaveEditOptions {
    isAuto?: boolean;
    allowInit?: boolean;
}

/**
 * Saves a new edit for the current note.
 */
export const saveNewEdit = createAsyncThunk<
    { newEditEntry: VersionHistoryEntry; deletedIds: string[] } | null,
    SaveEditOptions | boolean | undefined,
    ThunkConfig
>(
    'editHistory/saveNewEdit',
    async (arg, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        // Normalize argument
        const options: SaveEditOptions = typeof arg === 'boolean' 
            ? { isAuto: arg, allowInit: !arg } 
            : (arg || { isAuto: false, allowInit: true });
        
        const { isAuto = false, allowInit = !isAuto } = options;

        const state = getState().app;
        const uiService = services.uiService;
        const app = services.app;
        const editHistoryManager = services.editHistoryManager;
        const noteManager = services.noteManager;
        const manifestManager = services.manifestManager;
        const backgroundTaskManager = services.backgroundTaskManager;
        const eventBus = services.eventBus;

        if (!validateReadyState(state, uiService, isAuto)) {
             return rejectWithValue('Not ready');
        }

        const file = state.file;
        if (!validateFileExists(file, uiService, isAuto)) {
            return rejectWithValue('No file');
        }

        if (isAuto && !allowInit) {
            if (!state.noteId) {
                return null;
            }

            const manifest = await editHistoryManager.getEditManifest(state.noteId);
            if (!manifest) {
                return null;
            }
        }

        try {
            const liveFile = app.vault.getAbstractFileByPath(file.path);
            if (!(liveFile instanceof TFile)) throw new Error('File not found');

            let noteId = state.noteId;

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
                dispatch(historyApi.util.invalidateTags([{ type: 'EditHistory', id: noteId }]));
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

            if (shouldAbort(services, getState, { noteId })) return rejectWithValue('Context changed');

            if (result) {
                const { entry: newEditEntry, deletedIds } = result;

                eventBus.trigger('version-saved', noteId);

                if (!isAuto) {
                    uiService.showNotice(`Edit #${newEditEntry.versionNumber} saved.`);
                    backgroundTaskManager.resetTimer('edit');
                }
                
                // Invalidate RTK Query tags to update list and timeline
                dispatch(historyApi.util.invalidateTags([
                    { type: 'EditHistory', id: noteId },
                    { type: 'Timeline', id: noteId }
                ]));

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
