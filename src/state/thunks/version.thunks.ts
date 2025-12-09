import { TFile, App } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionControlSettings, VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { loadHistoryForNoteId, initializeView, loadEffectiveSettingsForNote } from './core.thunks';
import { loadEditHistory } from './edit-history.thunks';
import { VersionManager } from '../../core/version-manager';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { ManifestManager } from '../../core/manifest-manager';
import { PluginEvents } from '../../core/plugin-events';
import { TYPES } from '../../types/inversify.types';
import { resolveSettings, isPluginUnloading } from '../utils/settingsUtils';
import type VersionControlPlugin from '../../main';

/**
 * Thunks for direct version management (CRUD operations).
 */

export const saveNewVersion = (options: { isAuto?: boolean; settings?: VersionControlSettings } = {}): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const { isAuto = false, settings } = options;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();
    if (initialState.isRenaming) {
        if (!isAuto) uiService.showNotice("Cannot save version while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const app = container.get<App>(TYPES.App);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    if (initialState.status !== AppStatus.READY) {
        if (!isAuto) {
            console.warn("Version Control: Manual save attempt while not in Ready state. Aborting.", initialState.status);
            uiService.showNotice("VC: Cannot save version, the view is not ready.", 3000);
        }
        return;
    }
    const initialFileFromState = initialState.file;
    if (!initialFileFromState) {
        if (!isAuto) uiService.showNotice("VC: Cannot save, no active file is selected.", 3000);
        return;
    }

    dispatch(actions.setProcessing(true));

    try {
        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (!(liveFile instanceof TFile)) {
            uiService.showNotice(`VC: Cannot save because the note "${initialFileFromState.basename}" may have been moved or deleted.`);
            dispatch(initializeView());
            return;
        }

        // Determine settings to use:
        // 1. Explicit settings passed in options (e.g. from BackgroundTaskManager)
        // 2. Fallback to effective settings from state (for manual saves)
        let settingsToUse: VersionControlSettings;
        
        if (settings) {
            settingsToUse = settings;
        } else {
            const effectiveHistorySettings = initialState.effectiveSettings;
            settingsToUse = {
                ...initialState.settings, // Global VersionControlSettings (contains ID formats)
                ...effectiveHistorySettings // Flattened effective history settings (overrides logic flags)
            };
        }

        const result = await versionManager.saveNewVersionForFile(liveFile, { isAuto, settings: settingsToUse });

        const stateAfterSave = getState();
        if (isPluginUnloading(container) || stateAfterSave.status !== AppStatus.READY || stateAfterSave.file?.path !== initialFileFromState.path) {
            if (result.status === 'saved') {
                uiService.showNotice(`Version ${result.displayName} saved for "${liveFile.basename}" in the background.`, 4000);
            }
            return;
        }
        
        if (result.status === 'duplicate' || result.status === 'skipped_min_lines') {
            if (!isAuto && result.status === 'duplicate') {
                uiService.showNotice("Content is identical to the latest version. No new version was saved.", 4000);
            }
            return;
        }
        
        const { newVersionEntry, displayName, newNoteId } = result;
        if (newVersionEntry) {
            if (initialState.noteId !== newNoteId) {
                dispatch(actions.updateNoteIdInState({ noteId: newNoteId }));
            }

            dispatch(actions.addVersionSuccess({ newVersion: newVersionEntry }));
            
            if (!isAuto) {
                uiService.showNotice(`Version ${displayName} saved for "${liveFile.basename}".`);
            }
        }

    } catch (error) {
        console.error("Version Control: Error in saveNewVersion thunk.", error);
        if (!isAuto) {
            uiService.showNotice("An unexpected error occurred while saving the version. Please check the console.");
        }
        dispatch(initializeView());
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
            const finalState = getState();
            if (finalState.status === AppStatus.READY) {
                dispatch(actions.setProcessing(false));
            }
        }
    }
};

export const performAutoSave = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.isRenaming) {
        return; // Silently ignore auto-saves during rename
    }
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    
    const noteId = await noteManager.getNoteId(file) ?? await manifestManager.getNoteIdByPath(file.path);
    if (!noteId) return;

    // Resolve effective settings properly to respect local overrides
    const historySettings = await resolveSettings(noteId, 'version', container);
    const hybridSettings = {
        ...plugin.settings,
        ...historySettings
    };

    const result = await versionManager.saveNewVersionForFile(file, {
        name: 'Auto-save', 
        force: false, 
        isAuto: true, 
        settings: hybridSettings
    });
  
    if (result.status === 'saved' && result.newVersionEntry) {
        const currentState = getState();
        if (currentState.status === AppStatus.READY && currentState.file?.path === file.path) {
            if (currentState.noteId !== result.newNoteId) {
                dispatch(actions.updateNoteIdInState({ noteId: result.newNoteId }));
            }
            dispatch(actions.addVersionSuccess({ newVersion: result.newVersionEntry }));
        }
    }
};

export const updateVersionDetails = (versionId: string, details: { name: string; description: string }): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();
    if (state.isRenaming) {
        uiService.showNotice("Cannot edit version while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

    if (state.status !== AppStatus.READY) {
        return;
    }
    const noteId = state.noteId;
    const file = state.file;
    if (!noteId || !file) {
        return;
    }

    const updatePayload = {
        name: details.name.trim(),
        description: details.description.trim(),
    };

    // Optimistically update the UI for the current version ID
    dispatch(actions.updateVersionDetailsInState({ versionId, ...updatePayload }));
    
    // Also update the timeline panel if it's open, so changes reflect immediately
    dispatch(actions.updateTimelineEventInState({ versionId, ...updatePayload }));

    try {
        const newVersionId = await versionManager.updateVersionDetails(noteId, versionId, updatePayload);
        
        // Trigger event to update IndexedDB timeline metadata
        const eventBus = container.get<PluginEvents>(TYPES.EventBus);
        eventBus.trigger('version-updated', noteId, versionId, updatePayload);

        // If the ID changed due to renaming, we must reload the history to reflect the new ID in the state
        if (newVersionId !== versionId) {
             if (!isPluginUnloading(container)) {
                dispatch(loadHistoryForNoteId(file, noteId));
            }
        }
    } catch (error) {
        console.error(`VC: Failed to save details update for version ${versionId}. Reverting UI.`, error);
        uiService.showNotice("VC: Error, could not save version details. Reverting changes.", 5000);
        if (!isPluginUnloading(container)) {
            dispatch(loadHistoryForNoteId(file, noteId));
        }
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(actions.stopVersionEditing());
        }
    }
};

export const requestEditVersion = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.status !== AppStatus.READY) return;

    // This action does not open a new panel, so we must explicitly close the current one first.
    dispatch(actions.closePanel());
    dispatch(actions.startVersionEditing({ versionId: version.id }));
};

export const viewVersionInPanel = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    
    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("Cannot view version: context not ready.");
        return;
    }

    const { noteId, viewMode } = state;
    let content: string | null = null;

    dispatch(actions.setProcessing(true));

    try {
        if (viewMode === 'versions') {
            const versionManager = container.get<VersionManager>(TYPES.VersionManager);
            content = await versionManager.getVersionContent(noteId, version.id);
        } else {
            // We need to dynamically import or use container to get EditHistoryManager to avoid circular imports if any
            // But since we are in thunks, we can just use container.
            // Note: EditHistoryManager type is needed.
            const { EditHistoryManager } = require('../../core/edit-history-manager');
            const editHistoryManager = container.get<typeof EditHistoryManager>(TYPES.EditHistoryManager);
            content = await editHistoryManager.getEditContent(noteId, version.id);
        }

        if (content === null) {
            throw new Error("Content not found.");
        }

        // Check if state is still valid for this note before opening panel
        const currentState = getState();
        if (currentState.noteId !== noteId) {
             console.warn("VC: Note ID changed during preview load. Aborting panel open.");
             return;
        }

        dispatch(actions.openPanel({
            type: 'preview',
            version,
            content
        }));

    } catch (error) {
        console.error("VC: Failed to view version content.", error);
        uiService.showNotice("Failed to load content for preview.");
    } finally {
        if (!isPluginUnloading(container)) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const requestRestore = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.status !== AppStatus.READY) return;
    
    const file = state.file;
    if (!file) return;

    const versionLabel = version.name ? `"${version.name}" (V${version.versionNumber})` : `Version ${version.versionNumber}`;
    dispatch(actions.openPanel({
        type: 'confirmation',
        title: "Confirm restore",
        message: `This will overwrite the current content of "${file.basename}" with ${versionLabel}. A backup of the current content will be saved as a new version before restoring. Are you sure?`,
        onConfirmAction: restoreVersion(version.id),
    }));
};

export const restoreVersion = (versionId: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot restore version while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!initialFileFromState || !initialNoteIdFromState) return;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel()); 

    try {
        const liveFile = container.get<App>(TYPES.App).vault.getAbstractFileByPath(initialFileFromState.path);
        if (!(liveFile instanceof TFile)) {
            throw new Error(`Restore failed. Note "${initialFileFromState.basename}" may have been deleted or moved.`);
        }

        const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
        if (currentNoteIdOnDisk !== initialNoteIdFromState) {
            throw new Error(`Restore failed. Note's version control ID has changed or was removed. Expected "${initialNoteIdFromState}", found "${currentNoteIdOnDisk}".`);
        }

        // Resolve effective settings properly to respect local overrides
        const historySettings = await resolveSettings(initialNoteIdFromState, 'version', container);
        const hybridSettings = {
            ...plugin.settings,
            ...historySettings
        };

        await versionManager.saveNewVersionForFile(liveFile, { 
            name: `Backup before restoring V${versionId.substring(0,6)}...`, 
            force: true, 
            isAuto: false, 
            settings: hybridSettings 
        });

        const stateAfterBackup = getState();
        if (isPluginUnloading(container) || stateAfterBackup.status !== AppStatus.READY || stateAfterBackup.noteId !== initialNoteIdFromState) {
            uiService.showNotice(`Restore cancelled because the active note changed during backup.`, 5000);
            if (!isPluginUnloading(container)) {
                dispatch(initializeView());
            }
            return;
        }

        const restoreSuccess = await versionManager.restoreVersion(liveFile, initialNoteIdFromState, versionId);
        
        if (restoreSuccess) {
            uiService.showNotice(`Successfully restored "${liveFile.basename}" to version ${versionId.substring(0,6)}...`);
        }
        dispatch(loadHistoryForNoteId(liveFile, initialNoteIdFromState));

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        console.error("Version Control: Error in restoreVersion thunk.", error);
        uiService.showNotice(`Restore failed: ${message}`, 7000);
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
        }
    }
};

export const requestDelete = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    if (state.status === AppStatus.READY) {
        const { file, history } = state;
        if (!file) return;

        const isLastVersion = history.length === 1 && history[0]?.id === version.id;
        
        const versionLabel = version.name ? `"${version.name}" (V${version.versionNumber})` : `Version ${version.versionNumber}`;
        let message = `Are you sure you want to permanently delete ${versionLabel} for "${file.basename}"? This action cannot be undone.`;
        if (isLastVersion) {
            message += ` This is the last version in this branch. Deleting it will also delete the branch. If this is the only branch, the note will be removed from version control (its '${plugin.settings.noteIdFrontmatterKey}' will be cleared).`;
        }

        dispatch(actions.openPanel({
            type: 'confirmation',
            title: "Confirm delete",
            message: message,
            onConfirmAction: deleteVersion(version.id),
        }));
    }
};

export const deleteVersion = (versionId: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot delete version while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const app = container.get<App>(TYPES.App);

    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!initialFileFromState || !initialNoteIdFromState) return;
    
    const initialHistory = initialState.history;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (liveFile instanceof TFile) {
            const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
            if (currentNoteIdOnDisk !== initialNoteIdFromState && currentNoteIdOnDisk !== null) {
                throw new Error(`Delete failed. Note's version control ID has changed. Expected "${initialNoteIdFromState}", found "${currentNoteIdOnDisk}".`);
            }
        }

        const wasLastVersion = initialHistory.length === 1 && initialHistory[0]?.id === versionId;

        const success = await versionManager.deleteVersion(initialNoteIdFromState, versionId);

        const stateAfterDelete = getState();
        if (isPluginUnloading(container) || stateAfterDelete.file?.path !== initialFileFromState.path) {
            if (success) {
                uiService.showNotice(`Version deleted for "${initialFileFromState.basename}" in the background.`, 4000);
            }
            return;
        }

        if (success) {
            if (wasLastVersion) {
                uiService.showNotice(`Last version and branch deleted. "${initialFileFromState.basename}" may now be on a different branch or no longer under version control.`);
                dispatch(initializeView());
            } else {
                 dispatch(loadHistoryForNoteId(initialFileFromState, initialNoteIdFromState)); 
                 uiService.showNotice(`Version ${versionId.substring(0,6)}... deleted successfully.`);
            }
        } else {
            throw new Error(`Failed to delete version ${versionId.substring(0,6)}...`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        console.error("Version Control: Error in deleteVersion thunk.", error);
        uiService.showNotice(`Delete failed: ${message}`, 7000);
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    }
};

export const requestDeleteAll = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.status === AppStatus.READY) {
        const { file, currentBranch } = state;
        if (!file || !currentBranch) return;

        const basename = file.basename;
        dispatch(actions.openPanel({
            type: 'confirmation',
            title: `Delete all in branch "${currentBranch}"?`,
            message: `This will permanently delete all version history for the branch "${currentBranch}" of note "${basename}". This action cannot be undone. Are you sure?`,
            onConfirmAction: deleteAllVersions(),
        }));
    }
};

export const deleteAllVersions = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot delete history while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!initialFileFromState || !initialNoteIdFromState) return;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        const success = await versionManager.deleteAllVersionsInCurrentBranch(initialNoteIdFromState);

        if (isPluginUnloading(container) || getState().file?.path !== initialFileFromState.path) {
            if (success) {
                uiService.showNotice(`All versions for "${initialFileFromState.basename}" have been deleted in the background.`, 5000);
            }
            return;
        }

        if (success) {
            uiService.showNotice(`All versions for the current branch of "${initialFileFromState.basename}" have been deleted.`);
            dispatch(initializeView());
        } else {
            throw new Error(`Failed to delete all versions for "${initialFileFromState.basename}".`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        console.error("Version Control: Error in deleteAllVersions thunk.", error);
        uiService.showNotice(`Delete all failed: ${message}`, 7000);
        if (!isPluginUnloading(container)) {
            dispatch(initializeView());
        }
    }
};

export const createBranch = (newBranchName: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.status !== AppStatus.READY || !state.noteId) return;
    const { noteId } = state;

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        await versionManager.createBranch(noteId, newBranchName);
        dispatch(actions.closePanel());
        uiService.showNotice(`Branch "${newBranchName}" created.`, 3000);
        dispatch(switchBranch(newBranchName));
    } catch (error) {
        console.error("VC: Failed to create branch.", error);
        uiService.showNotice(`Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};

export const switchBranch = (newBranchName: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    const { noteId, file, viewMode } = state;

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    // We do NOT set isProcessing here anymore. We rely on the LOADING status set by clearHistoryForBranchSwitch.
    dispatch(actions.closePanel());

    try {
        // 1. Perform the switch on disk
        await versionManager.switchBranch(noteId, newBranchName);
        
        // 2. Invalidate cache to force fresh read
        manifestManager.invalidateNoteManifestCache(noteId);

        // 3. Verify stabilization
        // We read the manifest to ensure the file system has settled and returns the expected branch.
        const manifest = await manifestManager.loadNoteManifest(noteId);
        if (!manifest || manifest.currentBranch !== newBranchName) {
            throw new Error(`Branch switch verification failed. Expected "${newBranchName}", got "${manifest?.currentBranch}".`);
        }

        // 4. Clear state & Set Loading
        // This forces the UI to reset (show skeletons) and prevents stale state rendering.
        const availableBranches = Object.keys(manifest.branches);
        dispatch(actions.clearHistoryForBranchSwitch({
            currentBranch: newBranchName,
            availableBranches
        }));

        // 5. Load data for the new branch
        // We await settings first to ensure they are ready for whatever history loading needs them.
        await dispatch(loadEffectiveSettingsForNote(noteId));
        
        if (viewMode === 'edits') {
            await dispatch(loadEditHistory(noteId));
        } else {
            await dispatch(loadHistoryForNoteId(file, noteId));
        }
        
        // Sync watch mode (important if switching branches changes settings like auto-save)
        const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
        backgroundTaskManager.syncWatchMode();

        uiService.showNotice(`Switched to branch "${newBranchName}".`);

    } catch (error) {
        console.error("VC: Failed to switch branch.", error);
        uiService.showNotice(`Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        // Attempt to reload current state to ensure consistency
        dispatch(loadHistoryForNoteId(file, noteId));
    }
    // No finally block needed to unset processing, as success actions in loadHistory/loadEditHistory set status to READY.
};
