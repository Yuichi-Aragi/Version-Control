/**
 * Save Edit Thunk
 *
 * Handles saving new edits for a note
 */

import { App, TFile } from 'obsidian';
import type { AppThunk } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import { TYPES } from '@/types/inversify.types';
import { EditHistoryManager, NoteManager, ManifestManager, BackgroundTaskManager } from '@/core';
import { UIService } from '@/services';
import { calculateTextStats } from '@/utils/text-stats';
import { DEFAULT_BRANCH_NAME } from '@/constants';
import { isPluginUnloading, resolveSettings } from '@/state/utils/settingsUtils';
import { loadHistoryForNoteId } from '../../core.thunks';
import {
    createEditManifest,
    ensureBranchExists,
    calculateNextVersionNumber,
    isDuplicateContent,
} from '../helpers';

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
            // This also handles empty files correctly (returns empty string).
            const content = await app.vault.adapter.read(liveFile.path);

            // Get Note Manifest to determine the correct active branch
            const noteManifest = await manifestManager.loadNoteManifest(noteId);
            const activeBranch =
                noteManifest?.currentBranch || DEFAULT_BRANCH_NAME;

            // Get or Create Edit Manifest
            const existingManifest =
                await editHistoryManager.getEditManifest(noteId);
            let manifest = existingManifest;

            if (!existingManifest) {
                manifest = createEditManifest(noteId, file.path, activeBranch);
                // Mark note as having edit history in the central manifest
                await manifestManager.setHasEditHistory(noteId, true);
            } else {
                // Sync branch pointer
                if (manifest!.currentBranch !== activeBranch) {
                    manifest!.currentBranch = activeBranch;
                }
            }

            const branchName = manifest!.currentBranch;
            const branch = ensureBranchExists(manifest!, branchName);

            // --- Duplicate Check ---
            // Find the latest edit in the current branch to compare content
            const existingVersions = Object.entries(branch.versions);
            if (existingVersions.length > 0) {
                // Sort by version number desc
                existingVersions.sort(
                    ([, a], [, b]) => b.versionNumber - a.versionNumber
                );
                const [lastEditId] = existingVersions[0]!;

                const lastContent = await editHistoryManager.getEditContent(
                    noteId,
                    lastEditId,
                    branchName
                );

                if (isDuplicateContent(content, lastContent)) {
                    // Identical content, skip save
                    if (!isAuto)
                        uiService.showNotice(
                            'No changes detected since last edit.'
                        );
                    return;
                }
            }
            // -----------------------

            // Calculate next version number strictly incrementally
            const nextVersionNumber = calculateNextVersionNumber(
                branch.versions
            );

            // Edit ID: simple format, ignoring versionIdFormat
            const editId = `E${nextVersionNumber}_${Date.now()}`;
            const textStats = calculateTextStats(content);
            const timestamp = new Date().toISOString();
            const uncompressedSize = new Blob([content]).size;

            // Update Manifest
            branch.versions[editId] = {
                versionNumber: nextVersionNumber,
                timestamp,
                size: uncompressedSize, // Legacy/Default size field
                uncompressedSize: uncompressedSize, // Explicit uncompressed size
                // compressedSize will be populated by the worker
                wordCount: textStats.wordCount,
                wordCountWithMd: textStats.wordCountWithMd,
                charCount: textStats.charCount,
                charCountWithMd: textStats.charCountWithMd,
                lineCount: textStats.lineCount,
                lineCountWithoutMd: textStats.lineCountWithoutMd,
            };
            branch.totalVersions = nextVersionNumber;
            manifest!.lastModified = timestamp;

            // Save to IDB
            await editHistoryManager.saveEdit(
                noteId,
                branchName,
                editId,
                content,
                manifest!
            );

            const newEditEntry: VersionHistoryEntry = {
                id: editId,
                noteId,
                notePath: file.path,
                branchName,
                versionNumber: nextVersionNumber,
                timestamp,
                size: uncompressedSize,
                uncompressedSize: uncompressedSize,
                // Note: compressedSize is not available immediately in the thunk without reloading from worker
                // UI will fallback to uncompressedSize until reload
                wordCount: textStats.wordCount,
                wordCountWithMd: textStats.wordCountWithMd,
                charCount: textStats.charCount,
                charCountWithMd: textStats.charCountWithMd,
                lineCount: textStats.lineCount,
                lineCountWithoutMd: textStats.lineCountWithoutMd,
            };

            dispatch(appSlice.actions.addEditSuccess({ newEdit: newEditEntry }));
            if (!isAuto) {
                uiService.showNotice(`Edit #${nextVersionNumber} saved.`);
                // If manual save, reset the timer to skip the next immediate auto-save turn
                backgroundTaskManager.resetTimer('edit');
            }

            // --- Enforce History Limit ---
            try {
                const settings = await resolveSettings(noteId, 'edit', container);
                const maxVersions = settings.maxVersionsPerNote;

                // Re-evaluate versions list from the updated branch object
                const allVersions = Object.values(branch.versions);
                
                if (allVersions.length > maxVersions) {
                    // Sort by versionNumber ascending (oldest first)
                    const sortedEntries = Object.entries(branch.versions).sort(([, a], [, b]) => {
                        return (a as any).versionNumber - (b as any).versionNumber;
                    });

                    const excessCount = sortedEntries.length - maxVersions;
                    if (excessCount > 0) {
                        const entriesToDelete = sortedEntries.slice(0, excessCount);
                        const idsToDelete = entriesToDelete.map(([id]) => id);

                        // Perform deletion
                        for (const id of idsToDelete) {
                            delete branch.versions[id];
                            // Also delete from IDB
                            await editHistoryManager.deleteEdit(noteId, branchName, id);
                        }

                        // Save updated manifest
                        manifest!.lastModified = new Date().toISOString();
                        await editHistoryManager.saveEditManifest(noteId, manifest!);

                        // Update UI immediately to prevent stale data
                        dispatch(appSlice.actions.removeEditsSuccess({ ids: idsToDelete }));
                    }
                }
            } catch (limitError) {
                console.error('VC: Failed to enforce edit history limit', limitError);
                // Non-critical failure, do not throw
            }
            // -----------------------------

        } catch (error) {
            console.error('VC: Failed to save edit', error);
            if (!isAuto) uiService.showNotice('Failed to save edit.');
        } finally {
            if (!isPluginUnloading(container)) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    };
