import { App, TFile } from 'obsidian';
import { map, orderBy } from 'lodash-es';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import { AppStatus } from '../state';
import type { VersionHistoryEntry, NoteManifest } from '../../types';
import { TYPES } from '../../types/inversify.types';
import { EditHistoryManager } from '../../core/edit-history-manager';
import { NoteManager } from '../../core/note-manager';
import { ManifestManager } from '../../core/manifest-manager';

import { UIService } from '../../services/ui-service';

import { calculateTextStats } from '../../utils/text-stats';
import { DEFAULT_BRANCH_NAME } from '../../constants';
import { isPluginUnloading } from '../utils/settingsUtils';
import { loadHistoryForNoteId } from './core.thunks';


export const loadEditHistory = (noteId: string): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    
    try {
        // 1. Get Note Manifest (Source of Truth for Branches)
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        
        // If note manifest is missing (rare/error), fallback to basic empty state
        if (!noteManifest) {
             dispatch(actions.editHistoryLoadedSuccess({ editHistory: [], currentBranch: null, availableBranches: [] }));
             return;
        }

        const activeBranch = noteManifest.currentBranch;
        const availableBranches = Object.keys(noteManifest.branches);

        // 2. Get Edit Manifest
        let manifest = await editHistoryManager.getEditManifest(noteId);
        
        // 3. Sync/Initialize Edit Manifest Logic
        if (manifest) {
            let dirty = false;
            
            // Sync current branch pointer to match Note Manifest
            if (manifest.currentBranch !== activeBranch) {
                manifest.currentBranch = activeBranch;
                dirty = true;
            }

            // Ensure the active branch exists in edit manifest
            if (!manifest.branches[activeBranch]) {
                manifest.branches[activeBranch] = {
                    versions: {},
                    totalVersions: 0
                };
                dirty = true;
            }

            if (dirty) {
                await editHistoryManager.saveEditManifest(noteId, manifest);
            }
        }

        // 4. Extract History for Active Branch
        const currentBranchData = manifest?.branches[activeBranch];
        
        if (!manifest || !currentBranchData || !currentBranchData.versions) {
            dispatch(actions.editHistoryLoadedSuccess({ 
                editHistory: [], 
                currentBranch: activeBranch, 
                availableBranches 
            }));
            return;
        }

        const history = map(currentBranchData.versions, (data, id) => ({
            id,
            noteId,
            notePath: manifest!.notePath,
            branchName: activeBranch,
            versionNumber: data.versionNumber,
            timestamp: data.timestamp,
            size: data.size,
            compressedSize: data.compressedSize,
            uncompressedSize: data.uncompressedSize,
            ...(data.name && { name: data.name }),
            ...(data.description && { description: data.description }),
            wordCount: data.wordCount,
            wordCountWithMd: data.wordCountWithMd,
            charCount: data.charCount,
            charCountWithMd: data.charCountWithMd,
            lineCount: data.lineCount,
            lineCountWithoutMd: data.lineCountWithoutMd,
        }));

        const sortedHistory = orderBy(history, ['versionNumber'], ['desc']);
        
        dispatch(actions.editHistoryLoadedSuccess({ 
            editHistory: sortedHistory,
            currentBranch: activeBranch,
            availableBranches
        }));

    } catch (error) {
        console.error("VC: Failed to load edit history", error);
        dispatch(actions.editHistoryLoadedSuccess({ editHistory: [], currentBranch: null, availableBranches: [] }));
    }
};

export const saveNewEdit = (isAuto = false): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);

    if (state.status !== AppStatus.READY && !isAuto) {
        // Allow if we are in a state where we can initialize (e.g. valid file but no ID)
        if (!state.file) return;
    }
    
    const file = state.file;
    if (!file) return;

    dispatch(actions.setProcessing(true));

    try {
        // Read active content
        const liveFile = app.vault.getAbstractFileByPath(file.path);
        if (!(liveFile instanceof TFile)) throw new Error("File not found");
        
        let noteId = state.noteId;

        // Initialization logic if noteId is missing (First Edit)
        if (!noteId) {
            noteId = await noteManager.getOrCreateNoteId(liveFile);
            if (!noteId) throw new Error("Could not generate Note ID");

            // Ensure manifest exists (Version Manager usually does this, but we are in Edit mode)
            let noteManifest = await manifestManager.loadNoteManifest(noteId);
            if (!noteManifest) {
                noteManifest = await manifestManager.createNoteEntry(noteId, liveFile.path);
            }
            
            // Update state with new ID
            dispatch(actions.updateNoteIdInState({ noteId }));
            
            // Also need to ensure we have the version history loaded/initialized structure in state
            // so UI doesn't break
            dispatch(loadHistoryForNoteId(liveFile, noteId));
        }

        // Use adapter read to support both .md and .base files uniformly as text.
        // This also handles empty files correctly (returns empty string).
        const content = await app.vault.adapter.read(liveFile.path);
        
        // Get Note Manifest to determine the correct active branch
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        const activeBranch = noteManifest?.currentBranch || DEFAULT_BRANCH_NAME;

        // Get or Create Edit Manifest
        const existingManifest = await editHistoryManager.getEditManifest(noteId);
        let manifest: NoteManifest;

        if (!existingManifest) {
            const now = new Date().toISOString();
            manifest = {
                noteId,
                notePath: file.path,
                currentBranch: activeBranch,
                branches: {
                    [activeBranch]: {
                        versions: {},
                        totalVersions: 0
                    }
                },
                createdAt: now,
                lastModified: now,
            };
            await editHistoryManager.registerNoteInCentralManifest(noteId, file.path);
        } else {
            manifest = existingManifest;
            // Sync branch pointer
            if (manifest.currentBranch !== activeBranch) {
                manifest.currentBranch = activeBranch;
            }
        }

        const branchName = manifest.currentBranch;
        let branch = manifest.branches[branchName];
        if (!branch) {
            // If branch missing in edit manifest (e.g. newly created branch in versions), create it
            branch = {
                versions: {},
                totalVersions: 0
            };
            manifest.branches[branchName] = branch;
        }
        
        // --- Duplicate Check ---
        // Find the latest edit in the current branch to compare content
        const existingVersions = Object.entries(branch.versions);
        if (existingVersions.length > 0) {
            // Sort by version number desc
            existingVersions.sort(([, a], [, b]) => b.versionNumber - a.versionNumber);
            const [lastEditId, ] = existingVersions[0]!;
            
            const lastContent = await editHistoryManager.getEditContent(noteId, lastEditId, branchName);
            if (lastContent === content) {
                // Identical content, skip save
                if (!isAuto) uiService.showNotice("No changes detected since last edit.");
                return;
            }
        }
        // -----------------------

        // Calculate next version number strictly incrementally
        const existingVersionNumbers = Object.values(branch.versions).map(v => v.versionNumber);
        const maxVersion = existingVersionNumbers.length > 0 ? Math.max(...existingVersionNumbers) : 0;
        const nextVersionNumber = maxVersion + 1;

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
        manifest.lastModified = timestamp;

        // Save to IDB
        await editHistoryManager.saveEdit(noteId, branchName, editId, content, manifest);

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

        dispatch(actions.addEditSuccess({ newEdit: newEditEntry }));
        if (!isAuto) {
            uiService.showNotice(`Edit #${nextVersionNumber} saved.`);
        }

    } catch (error) {
        console.error("VC: Failed to save edit", error);
        if (!isAuto) uiService.showNotice("Failed to save edit.");
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const updateEditDetails = (editId: string, details: { name: string; description: string }): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    dispatch(actions.updateVersionDetailsInState({ versionId: editId, ...details }));

    try {
        const manifest = await editHistoryManager.getEditManifest(noteId);
        if (!manifest) throw new Error("Manifest not found");

        const branch = manifest.branches[manifest.currentBranch];
        const editData = branch?.versions[editId];
        if (!editData) throw new Error("Edit not found");
        
        // For now, just update metadata in manifest
        if (details.name) editData.name = details.name;
        else delete editData.name;
        
        if (details.description) editData.description = details.description;
        else delete editData.description;

        manifest.lastModified = new Date().toISOString();
        
        await editHistoryManager.saveEditManifest(noteId, manifest);

    } catch (error) {
        console.error("VC: Failed to update edit details", error);
        uiService.showNotice("Failed to update edit details.");
        dispatch(loadEditHistory(noteId)); // Revert
    } finally {
        dispatch(actions.stopVersionEditing());
    }
};

export const deleteEdit = (editId: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        const manifest = await editHistoryManager.getEditManifest(noteId);
        if (!manifest) throw new Error("Manifest not found");

        const branchName = manifest.currentBranch;
        const branch = manifest.branches[branchName];
        
        if (branch && branch.versions[editId]) {
            delete branch.versions[editId];
            manifest.lastModified = new Date().toISOString();
            
            // If empty, maybe delete whole history?
            const remaining = Object.keys(branch.versions).length;
            if (remaining === 0) {
                 delete manifest.branches[branchName];
                 if (Object.keys(manifest.branches).length === 0) {
                     await editHistoryManager.deleteNoteHistory(noteId);
                     await editHistoryManager.unregisterNoteFromCentralManifest(noteId);
                     dispatch(loadEditHistory(noteId));
                     uiService.showNotice("Edit history deleted.");
                     return;
                 }
            }
            
            await editHistoryManager.saveEditManifest(noteId, manifest);
        }

        await editHistoryManager.deleteEdit(noteId, branchName, editId);
        
        dispatch(loadEditHistory(noteId));
        uiService.showNotice("Edit deleted.");

    } catch (error) {
        console.error("VC: Failed to delete edit", error);
        uiService.showNotice("Failed to delete edit.");
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const restoreEdit = (editId: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    const { noteId, file, currentBranch } = state;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        const content = await editHistoryManager.getEditContent(noteId, editId, currentBranch!);
        if (content === null) throw new Error("Content not found");

        const liveFile = app.vault.getAbstractFileByPath(file.path);
        if (liveFile instanceof TFile) {
            await app.vault.modify(liveFile, content);
            uiService.showNotice(`Restored Edit #${editId.substring(0,6)}...`);
        }
    } catch (error) {
        console.error("VC: Failed to restore edit", error);
        uiService.showNotice("Failed to restore edit.");
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const requestDeleteEdit = (edit: VersionHistoryEntry): AppThunk => (dispatch, _getState, _container) => {
    dispatch(actions.openPanel({
        type: 'confirmation',
        title: "Confirm delete edit",
        message: `Permanently delete this edit?`,
        onConfirmAction: deleteEdit(edit.id),
    }));
};

export const requestRestoreEdit = (edit: VersionHistoryEntry): AppThunk => (dispatch, _getState, _container) => {
    dispatch(actions.openPanel({
        type: 'confirmation',
        title: "Confirm restore edit",
        message: `Overwrite current note with this edit?`,
        onConfirmAction: restoreEdit(edit.id),
    }));
};
