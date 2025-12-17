/**
 * Load Edit History Thunk
 *
 * Handles loading edit history for a note
 */

import type { AppThunk } from '@/state';
import { appSlice } from '@/state';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager, ManifestManager } from '@/core';
import { isPluginUnloading } from '@/state/utils/settingsUtils';
import { buildEditHistory, syncEditManifest } from '../helpers';

/**
 * Loads edit history for a specific note
 *
 * @param noteId - The note ID to load history for
 * @returns AppThunk that loads and dispatches edit history
 */
export const loadEditHistory =
    (noteId: string): AppThunk =>
    async (dispatch, _getState, container) => {
        if (isPluginUnloading(container)) return;

        const editHistoryManager =
            container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        const manifestManager =
            container.get<ManifestManager>(TYPES.ManifestManager);

        try {
            // 1. Get Note Manifest (Source of Truth for Branches)
            let noteManifest = await manifestManager.loadNoteManifest(noteId);

            // Lazy Recovery: If physical manifest is missing but central manifest has it (e.g. migration from edit-only history)
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

            // If still missing, return empty state
            if (!noteManifest) {
                dispatch(
                    appSlice.actions.editHistoryLoadedSuccess({
                        editHistory: [],
                        currentBranch: null,
                        availableBranches: [],
                    })
                );
                return;
            }

            const activeBranch = noteManifest.currentBranch;
            const availableBranches = Object.keys(noteManifest.branches);

            // NEW: Load cache from disk for the active branch
            // This populates the IDB with the source of truth from the .vctrl file
            await editHistoryManager.loadBranchFromDisk(noteId, activeBranch);

            // 2. Get Edit Manifest
            let manifest = await editHistoryManager.getEditManifest(noteId);

            // 3. Sync/Initialize Edit Manifest Logic
            if (manifest) {
                const syncResult = syncEditManifest(manifest, activeBranch);

                if (syncResult.dirty) {
                    await editHistoryManager.saveEditManifest(noteId, manifest);
                }
            }

            // 4. Extract History for Active Branch
            const currentBranchData = manifest?.branches[activeBranch];

            if (!manifest || !currentBranchData || !currentBranchData.versions) {
                dispatch(
                    appSlice.actions.editHistoryLoadedSuccess({
                        editHistory: [],
                        currentBranch: activeBranch,
                        availableBranches,
                    })
                );
                return;
            }

            const sortedHistory = buildEditHistory(
                manifest,
                noteId,
                activeBranch
            );

            dispatch(
                appSlice.actions.editHistoryLoadedSuccess({
                    editHistory: sortedHistory,
                    currentBranch: activeBranch,
                    availableBranches,
                })
            );
        } catch (error) {
            console.error('VC: Failed to load edit history', error);
            dispatch(
                appSlice.actions.editHistoryLoadedSuccess({
                    editHistory: [],
                    currentBranch: null,
                    availableBranches: [],
                })
            );
        }
    };
