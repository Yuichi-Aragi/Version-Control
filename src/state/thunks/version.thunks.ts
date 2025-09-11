import { TFile, App, debounce } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { NOTE_FRONTMATTER_KEY, DEFAULT_SETTINGS } from '../../constants';
import { loadHistoryForNoteId, initializeView } from './core.thunks';
import { VersionManager } from '../../core/version-manager';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { BackgroundTaskManager } from '../../core/BackgroundTaskManager';
import { ManifestManager } from '../../core/manifest-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';

/**
 * Thunks for direct version management (CRUD operations).
 */

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

        const result = await versionManager.saveNewVersionForFile(liveFile);

        const stateAfterSave = getState();
        if (isPluginUnloading(container) || stateAfterSave.status !== AppStatus.READY || stateAfterSave.file?.path !== initialFileFromState.path) {
            if (result.status === 'saved') {
                uiService.showNotice(`Version ${result.displayName} saved for "${liveFile.basename}" in the background.`, 4000);
            }
            return;
        }
        
        if (result.status === 'duplicate') {
            if (!isAuto) {
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

export const updateVersionDetails = (versionId: string, name: string): AppThunk => async (dispatch, getState, container) => {
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

    const version_name = name.trim();
    dispatch(actions.updateVersionDetailsInState({ versionId, name: version_name }));

    try {
        await versionManager.updateVersionDetails(noteId, versionId, version_name);
    } catch (error) {
        console.error(`VC: Failed to save name update for version ${versionId}. Reverting UI.`, error);
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

        await versionManager.saveNewVersionForFile(liveFile, `Backup before restoring V${versionId.substring(0,6)}...`, { force: true });

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
    if (state.status === AppStatus.READY) {
        const { file, history } = state;
        if (!file) return;

        const firstVersion = history.length > 0 ? history[0] : null;
        const isLastVersion = history.length === 1 && firstVersion && firstVersion.id === version.id;
        
        const versionLabel = version.name ? `"${version.name}" (V${version.versionNumber})` : `Version ${version.versionNumber}`;
        let message = `Are you sure you want to permanently delete ${versionLabel} for "${file.basename}"? This action cannot be undone.`;
        if (isLastVersion) {
            message += ` This is the last version. Deleting it will also remove the note from version control (its ${NOTE_FRONTMATTER_KEY} will be cleared).`;
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

        const firstVersion = initialHistory.length > 0 ? initialHistory[0] : null;
        const wasLastVersion = initialHistory.length === 1 && firstVersion && firstVersion.id === versionId;

        const success = await versionManager.deleteVersion(initialNoteIdFromState, versionId);

        const stateAfterDelete = getState();
        if (isPluginUnloading(container) || stateAfterDelete.status !== AppStatus.READY || stateAfterDelete.noteId !== initialNoteIdFromState) {
            if (success) {
                uiService.showNotice(`Version deleted for "${initialFileFromState.basename}" in the background.`, 4000);
            }
            return;
        }

        if (success) {
            if (wasLastVersion) {
                uiService.showNotice(`Last version deleted. "${initialFileFromState.basename}" is no longer under version control.`);
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
        const { file } = state;
        if (!file) return;

        const basename = file.basename;
        dispatch(actions.openPanel({
            type: 'confirmation',
            title: "Confirm delete all",
            message: `This will permanently delete all version history for "${basename}" and remove it from version control (its ${NOTE_FRONTMATTER_KEY} will be cleared). This action cannot be undone. Are you sure?`,
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
        const success = await versionManager.deleteAllVersions(initialNoteIdFromState);

        if (isPluginUnloading(container) || getState().file?.path !== initialFileFromState.path) {
            if (success) {
                uiService.showNotice(`All versions for "${initialFileFromState.basename}" have been deleted in the background.`, 5000);
            }
            return;
        }

        if (success) {
            uiService.showNotice(`All versions for "${initialFileFromState.basename}" have been deleted.`);
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

/**
 * The actual auto-save logic. This is called by the debounced function.
 */
export const performAutoSave = (file: TFile): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    if (state.isRenaming) {
        return; // Silently ignore auto-saves during rename
    }
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

    const result = await versionManager.saveNewVersionForFile(file, 'Auto-save', { force: false });
  
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

/**
 * Handles the vault's `modify` event. This thunk is responsible for debouncing
 * auto-save requests to prevent queue flooding.
 */
export const handleVaultSave = (file: TFile): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
  
    const noteId = await noteManager.getNoteId(file) ?? await manifestManager.getNoteIdByPath(file.path);
    if (!noteId) return;
  
    let effectiveSettings = { ...DEFAULT_SETTINGS };
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (noteManifest?.settings) {
            effectiveSettings = { ...effectiveSettings, ...noteManifest.settings };
        }
    } catch (e) {
        // Manifest might not exist yet. Use default settings.
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
