import { TFile, App, debounce } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionControlSettings, VersionHistoryEntry, AppError } from '../../types';
import { AppStatus } from '../state';
import { loadHistoryForNoteId, initializeView, loadHistory } from './core.thunks';
import { VersionManager } from '../../core/version-manager';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { ManifestManager } from '../../core/manifest-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';

/**
 * Thunks for direct version management (CRUD operations).
 */

export const autoRegisterNote = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    // Set a loading state for the file
    dispatch(actions.initializeView({ file, noteId: null, source: 'none' }));
    
    try {
        const result = await versionManager.saveNewVersionForFile(file, {
            name: 'Initial Version',
            isAuto: true,
            force: true, // Save even if empty
            settings: getState().settings,
        });

        if (result.status === 'saved') {
            uiService.showNotice(`"${file.basename}" is now under version control.`);
            // After saving, we have a noteId and history, so we can load it directly.
            dispatch(loadHistoryForNoteId(file, result.newNoteId));
        } else {
            // This could happen if another process registered it, or if content is identical to a deleted note's last version.
            // In this case, just proceed with a normal history load.
            dispatch(loadHistory(file));
        }
    } catch (error) {
        console.error(`Version Control: Failed to auto-register note "${file.path}".`, error);
        const appError: AppError = {
            title: "Auto-registration failed",
            message: `Could not automatically start version control for "${file.basename}".`,
            details: error instanceof Error ? error.message : String(error),
        };
        dispatch(actions.reportError(appError));
    } finally {
        if (!isPluginUnloading(container)) {
            backgroundTaskManager.syncWatchMode();
        }
    }
};

export const saveNewVersion = (options: { isAuto?: boolean } = {}): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const { isAuto = false } = options;
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

        const result = await versionManager.saveNewVersionForFile(liveFile, { isAuto, settings: initialState.settings });

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

    dispatch(actions.updateVersionDetailsInState({ versionId, ...updatePayload }));

    try {
        await versionManager.updateVersionDetails(noteId, versionId, updatePayload);
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
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
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

        const globalSettings = plugin.settings;
        let effectiveSettings: VersionControlSettings = { ...globalSettings };
        try {
            const noteManifest = await manifestManager.loadNoteManifest(initialNoteIdFromState);
            const currentBranch = noteManifest?.branches[noteManifest.currentBranch];
            const perBranchSettings = currentBranch?.settings;
            const isUnderGlobalInfluence = perBranchSettings?.isGlobal === true || perBranchSettings === undefined;
            if (!isUnderGlobalInfluence) {
                const definedBranchSettings = Object.fromEntries(
                    Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
                );
                effectiveSettings = { ...globalSettings, ...definedBranchSettings };
            }
        } catch (e) { /* use global on error */ }

        await versionManager.saveNewVersionForFile(liveFile, { 
            name: `Backup before restoring V${versionId.substring(0,6)}...`, 
            force: true, 
            isAuto: false, 
            settings: effectiveSettings 
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

    const globalSettings = plugin.settings;
    let effectiveSettings: VersionControlSettings = { ...globalSettings };
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        const currentBranch = noteManifest?.branches[noteManifest.currentBranch];
        const perBranchSettings = currentBranch?.settings;
        const isUnderGlobalInfluence = perBranchSettings?.isGlobal === true || perBranchSettings === undefined;
        if (!isUnderGlobalInfluence) {
            const definedBranchSettings = Object.fromEntries(
                Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
            );
            effectiveSettings = { ...globalSettings, ...definedBranchSettings };
        }
    } catch (e) { /* use global on error */ }

    const result = await versionManager.saveNewVersionForFile(file, {
        name: 'Auto-save', 
        force: false, 
        isAuto: true, 
        settings: effectiveSettings
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

export const handleVaultSave = (file: TFile): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
  
    const noteId = await noteManager.getNoteId(file) ?? await manifestManager.getNoteIdByPath(file.path);
    if (!noteId) return;
  
    const globalSettings = plugin.settings;
    let effectiveSettings: VersionControlSettings = { ...globalSettings };
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (noteManifest) {
            const currentBranch = noteManifest.branches[noteManifest.currentBranch];
            const perBranchSettings = currentBranch?.settings;
            const isUnderGlobalInfluence = perBranchSettings?.isGlobal === true || perBranchSettings === undefined;
            if (!isUnderGlobalInfluence) {
                const definedBranchSettings = Object.fromEntries(
                    Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
                );
                effectiveSettings = { ...globalSettings, ...definedBranchSettings };
            }
        }
    } catch (e) {
        // Manifest might not exist yet. Use global settings.
    }
  
    const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);

    if (!effectiveSettings.autoSaveOnSave) {
        if (debouncerInfo) {
            debouncerInfo.debouncer.cancel();
            plugin.autoSaveDebouncers.delete(file.path);
        }
        return;
    }
    
    const intervalMs = (effectiveSettings.autoSaveOnSaveInterval || 2) * 1000;

    if (debouncerInfo && debouncerInfo.interval === intervalMs) {
        debouncerInfo.debouncer(file);
    } else {
        debouncerInfo?.debouncer.cancel();

        const newDebouncerFunc = debounce(
            (f: TFile) => {
                dispatch(performAutoSave(f));
            },
            intervalMs
        );

        plugin.autoSaveDebouncers.set(file.path, { debouncer: newDebouncerFunc, interval: intervalMs });
        
        newDebouncerFunc(file);
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
    const { noteId, file } = state;

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);

    try {
        await versionManager.switchBranch(noteId, newBranchName);
        dispatch(actions.closePanel());
        dispatch(loadHistoryForNoteId(file, noteId));
    } catch (error) {
        console.error("VC: Failed to switch branch.", error);
        uiService.showNotice(`Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
