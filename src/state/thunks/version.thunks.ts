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
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    const initialState = getState();
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

        // Re-validate state after await
        const stateAfterSave = getState();
        if (isPluginUnloading(container) || stateAfterSave.status !== AppStatus.READY || stateAfterSave.file?.path !== initialFileFromState.path) {
            if (result.status === 'saved') {
                uiService.showNotice(`Version ${result.displayName} saved for "${liveFile.basename}" in the background.`, 4000);
            }
            // Abort UI update for the now-incorrect context.
            return;
        }
        
        if (result.status === 'duplicate') {
            if (!isAuto) {
                uiService.showNotice("Content is identical to the latest version. No new version was saved.", 4000);
            }
            return; // Return early, finally block will still execute
        }
        
        // It was saved, and we are still on the same note.
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
            backgroundTaskManager.syncWatchMode(); // Reset the timer after any save attempt.
            const finalState = getState();
            if (finalState.status === AppStatus.READY) {
                dispatch(actions.setProcessing(false));
            }
        }
    }
};

export const updateVersionDetails = (versionId: string, name: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY) {
        return;
    }
    const noteId = state.noteId;
    const file = state.file;
    if (!noteId || !file) {
        return;
    }

    // Optimistic UI update
    const version_name = name.trim();
    dispatch(actions.updateVersionDetailsInState({ versionId, name: version_name }));

    try {
        await versionManager.updateVersionDetails(noteId, versionId, version_name);
    } catch (error) {
        console.error(`VC: Failed to save name update for version ${versionId}. Reverting UI.`, error);
        uiService.showNotice("VC: Error, could not save version details. Reverting changes.", 5000);
        // On failure, reload history to revert the optimistic update
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
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    
    const initialState = getState();
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

        // Re-validate state after the backup save operation.
        const stateAfterBackup = getState();
        if (isPluginUnloading(container) || stateAfterBackup.status !== AppStatus.READY || stateAfterBackup.noteId !== initialNoteIdFromState) {
            uiService.showNotice(`Restore cancelled because the active note changed during backup.`, 5000);
            // Re-initialize to the new context to avoid inconsistent state.
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

        // Explicit null-safe check for history array
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
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const noteManager = container.get<NoteManager>(TYPES.NoteManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);

    const initialState = getState();
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

        // FIX: Explicit null-safe check for history array
        const firstVersion = initialHistory.length > 0 ? initialHistory[0] : null;
        const wasLastVersion = initialHistory.length === 1 && firstVersion && firstVersion.id === versionId;

        const success = await versionManager.deleteVersion(initialNoteIdFromState, versionId);

        // Re-validate state after the delete operation.
        const stateAfterDelete = getState();
        if (isPluginUnloading(container) || stateAfterDelete.status !== AppStatus.READY || stateAfterDelete.noteId !== initialNoteIdFromState) {
            if (success) {
                uiService.showNotice(`Version deleted for "${initialFileFromState.basename}" in the background.`, 4000);
            }
            // The context has changed, so we don't need to update the UI for the old note.
            // The new note's UI is already correct. Just abort.
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

        // Create explicit variable to satisfy TypeScript
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
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY) return;

    const initialFileFromState = initialState.file;
    const initialNoteIdFromState = initialState.noteId;
    if (!initialFileFromState || !initialNoteIdFromState) return;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        const success = await versionManager.deleteAllVersions(initialNoteIdFromState);

        // Re-validate state after the delete operation.
        // Check if the view is still on the same file. After this operation, the noteId will be gone,
        // so checking the file path is the only reliable way.
        if (isPluginUnloading(container) || getState().file?.path !== initialFileFromState.path) {
            if (success) {
                uiService.showNotice(`All versions for "${initialFileFromState.basename}" have been deleted in the background.`, 5000);
            }
            // Abort UI update for the wrong note.
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
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);

    // The saveNewVersionForFile is already robust, queued, and handles duplicate content checks.
    const result = await versionManager.saveNewVersionForFile(file, 'Auto-save', { force: false });
  
    // If the save was successful and this is the active note in the VC panel, update the UI.
    if (result.status === 'saved' && result.newVersionEntry) {
        const state = getState();
        // Check if the UI needs updating. It only should if the user is looking at the panel for this file.
        if (state.status === AppStatus.READY && state.file?.path === file.path) {
            // If the note didn't have an ID in the state before (first version), update it.
            if (state.noteId !== result.newNoteId) {
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
  
    // Find noteId from frontmatter first, then manifest.
    const noteId = await noteManager.getNoteId(file) ?? await manifestManager.getNoteIdByPath(file.path);
    // If the note is not versioned at all, there's nothing to do.
    if (!noteId) return;
  
    // Determine the effective settings for this specific note, falling back to defaults.
    let effectiveSettings = { ...DEFAULT_SETTINGS };
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (noteManifest?.settings) {
            effectiveSettings = { ...effectiveSettings, ...noteManifest.settings };
        }
    } catch (e) {
        // Manifest might not exist yet if this is the first interaction after getting a vc-id.
        // This is a normal condition; we'll simply use the default settings.
    }
  
    const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);

    // If auto-save is disabled for this note, ensure any lingering debouncer is cancelled and removed.
    if (!effectiveSettings.autoSaveOnSave) {
        if (debouncerInfo) {
            debouncerInfo.debouncer.cancel();
            plugin.autoSaveDebouncers.delete(file.path);
        }
        return;
    }
    
    // Auto-save is enabled. Get or create a debouncer with the correct interval.
    const intervalMs = (effectiveSettings.autoSaveOnSaveInterval || 2) * 1000;

    // If a correct debouncer already exists, just trigger it.
    if (debouncerInfo && debouncerInfo.interval === intervalMs) {
        debouncerInfo.debouncer(file);
    } else {
        // Otherwise, the debouncer is missing or its interval is stale. Re-create it.
        // Cancel the old one if it exists to prevent it from firing.
        debouncerInfo?.debouncer.cancel();

        const newDebouncerFunc = debounce(
            (f: TFile) => {
                // The debounced function dispatches the thunk that performs the actual save.
                dispatch(performAutoSave(f));
            },
            intervalMs
        );

        plugin.autoSaveDebouncers.set(file.path, { debouncer: newDebouncerFunc, interval: intervalMs });
        
        // Trigger the newly created debouncer.
        newDebouncerFunc(file);
    }
};
