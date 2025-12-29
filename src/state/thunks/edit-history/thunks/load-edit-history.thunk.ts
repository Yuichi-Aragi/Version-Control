import { createAsyncThunk } from '@reduxjs/toolkit';
import { shouldAbort } from '@/state/utils/guards';
import type { ThunkConfig } from '@/state/store';
import type { VersionHistoryEntry } from '@/types';
import { buildEditHistory, syncEditManifest } from '../helpers';

/**
 * Loads edit history for a specific note.
 */
export const loadEditHistory = createAsyncThunk<
    { editHistory: VersionHistoryEntry[]; currentBranch: string | null; availableBranches: string[]; contextVersion: number },
    string,
    ThunkConfig
>(
    'editHistory/loadEditHistory',
    async (noteId, { getState, extra: services, rejectWithValue }) => {
        // Capture context version immediately
        const contextVersion = getState().app.contextVersion;
        
        if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

        const editHistoryManager = services.editHistoryManager;
        const manifestManager = services.manifestManager;

        try {
            // 1. Get Note Manifest
            let noteManifest = await manifestManager.loadNoteManifest(noteId);

            // Lazy Recovery
            if (!noteManifest) {
                const centralManifest = await manifestManager.loadCentralManifest();
                const centralEntry = centralManifest.notes[noteId];
                
                if (centralEntry) {
                    console.log(`VC: Recovering missing physical manifest for note ${noteId} based on central registry.`);
                    try {
                        noteManifest = await manifestManager.recoverMissingNoteManifest(noteId, centralEntry.notePath);
                    } catch (e) {
                        console.error(`VC: Failed to recover manifest for note ${noteId}`, e);
                    }
                }
            }

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            // If still missing, return empty state
            if (!noteManifest) {
                return {
                    editHistory: [],
                    currentBranch: null,
                    availableBranches: [],
                    contextVersion,
                };
            }

            const activeBranch = noteManifest.currentBranch;
            const availableBranches = Object.keys(noteManifest.branches);

            // 2. Load cache from disk
            await editHistoryManager.loadBranchFromDisk(noteId, activeBranch);

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            // 3. Get Edit Manifest
            let manifest = await editHistoryManager.getEditManifest(noteId);

            // 4. Sync/Initialize Edit Manifest Logic
            if (manifest) {
                const syncResult = syncEditManifest(manifest, activeBranch);

                if (syncResult.dirty) {
                    await editHistoryManager.saveEditManifest(noteId, manifest);
                }
            }

            // 5. Extract History
            const currentBranchData = manifest?.branches[activeBranch];

            // Race Check
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            if (!manifest || !currentBranchData || !currentBranchData.versions) {
                return {
                    editHistory: [],
                    currentBranch: activeBranch,
                    availableBranches,
                    contextVersion,
                };
            }

            const sortedHistory = buildEditHistory(
                manifest,
                noteId,
                activeBranch
            );

            return {
                editHistory: sortedHistory,
                currentBranch: activeBranch,
                availableBranches,
                contextVersion,
            };

        } catch (error) {
            // Check context before reporting error
            if (shouldAbort(services, getState, { contextVersion })) return rejectWithValue('Context changed');

            console.error('VC: Failed to load edit history', error);
            // Return empty state on error to clear UI
            return {
                editHistory: [],
                currentBranch: null,
                availableBranches: [],
                contextVersion,
            };
        }
    }
);
