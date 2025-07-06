import { TFile, App, MarkdownView } from 'obsidian';
import { Thunk } from '../store';
import { actions } from '../actions';
import { VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { NOTE_FRONTMATTER_KEY, SERVICE_NAMES } from '../../constants';
import { loadHistoryForNoteId, initializeView } from './core.thunks';
import { VersionManager } from '../../core/version-manager';
import { NoteManager } from '../../core/note-manager';
import { UIService } from '../../services/ui-service';
import { BackgroundTaskManager } from '../../core/BackgroundTaskManager';

/**
 * Thunks for direct version management (CRUD operations).
 */

export const saveNewVersion = (options: { isAuto?: boolean } = {}): Thunk => async (dispatch, getState, container) => {
    const { isAuto = false } = options;
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const app = container.resolve<App>(SERVICE_NAMES.APP);
    const backgroundTaskManager = container.resolve<BackgroundTaskManager>(SERVICE_NAMES.BACKGROUND_TASK_MANAGER);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY) {
        if (!isAuto) {
            console.warn("Version Control: Manual save attempt while not in Ready state. Aborting.", initialState.status);
            uiService.showNotice("VC: Cannot save version, view not ready.", 3000);
        }
        return;
    }
    const { file: initialFileFromState } = initialState;

    dispatch(actions.setProcessing(true));

    try {
        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (!(liveFile instanceof TFile)) {
            uiService.showNotice(`VC: Cannot save. Note "${initialFileFromState.basename}" may have been moved or deleted.`);
            dispatch(initializeView());
            return;
        }

        const result = await versionManager.saveNewVersionForFile(liveFile);
        
        if (result.status === 'duplicate') {
            if (!isAuto) {
                uiService.showNotice("Content is identical to the latest version. No new version was saved.", 4000);
            } else {
                console.log("VC (Watch Mode): Content unchanged. Skipping auto-save.");
            }
            return; // Return early, finally block will still execute
        }
        
        // It was saved
        const { newVersionEntry, displayName, newNoteId } = result;
        if (newVersionEntry) {
            if (initialState.noteId !== newNoteId) {
                dispatch(actions.updateNoteIdInState(newNoteId));
            }

            dispatch(actions.addVersionSuccess(newVersionEntry));
            
            if (!isAuto) {
                uiService.showNotice(`Version ${displayName} saved for "${liveFile.basename}".`);
            } else {
                console.log(`VC (Watch Mode): Auto-saved version ${displayName} for "${liveFile.basename}".`);
            }
        }

    } catch (error) {
        console.error("Version Control: Error in saveNewVersion thunk.", error);
        if (!isAuto) {
            uiService.showNotice("An unexpected error occurred while saving the version. Please check the console.");
        }
        dispatch(initializeView(app.workspace.activeLeaf));
    } finally {
        backgroundTaskManager.manageWatchModeInterval(); // Reset the timer after any save attempt.
        const finalState = getState();
        if (finalState.status === AppStatus.READY) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const updateVersionDetails = (versionId: string, name: string): Thunk => async (dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) {
        return;
    }
    const noteId = state.noteId;

    // Optimistic UI update
    const version_name = name.trim();
    dispatch(actions.updateVersionDetailsInState(versionId, version_name || undefined));

    try {
        await versionManager.updateVersionDetails(noteId, versionId, version_name);
    } catch (error) {
        console.error(`VC: Failed to save name update for version ${versionId}. Reverting UI.`, error);
        uiService.showNotice("VC: Error: Could not save version details. Reverting changes.", 5000);
        // On failure, reload history to revert the optimistic update
        dispatch(loadHistoryForNoteId(state.file, noteId));
    } finally {
        dispatch(actions.stopVersionEditing());
    }
};

export const requestEditVersion = (version: VersionHistoryEntry): Thunk => (dispatch, getState) => {
    const state = getState();
    if (state.status !== AppStatus.READY) return;
    dispatch(actions.startVersionEditing(version.id));
};

export const requestRestore = (version: VersionHistoryEntry): Thunk => (dispatch, getState) => {
    const state = getState();
    if (state.status !== AppStatus.READY) return;

    const versionLabel = version.name ? `"${version.name}" (V${version.versionNumber})` : `Version ${version.versionNumber}`;
    dispatch(actions.openConfirmation({
        title: "Confirm Restore",
        message: `This will overwrite the current content of "${state.file.basename}" with ${versionLabel}. A backup of the current content will be saved as a new version before restoring. Are you sure?`,
        onConfirmAction: restoreVersion(version.id),
    }));
};

export const restoreVersion = (versionId: string): Thunk => async (dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const app = container.resolve<App>(SERVICE_NAMES.APP);
    const backgroundTaskManager = container.resolve<BackgroundTaskManager>(SERVICE_NAMES.BACKGROUND_TASK_MANAGER);
    
    const initialState = getState();
    if (initialState.status !== AppStatus.READY) return;
    const { file: initialFileFromState, noteId: initialNoteIdFromState } = initialState;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel()); 

    try {
        if (!initialNoteIdFromState) {
            throw new Error("Cannot restore. Current note is not under version control.");
        }

        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (!(liveFile instanceof TFile)) {
            throw new Error(`Restore failed. Note "${initialFileFromState.basename}" may have been deleted or moved.`);
        }

        const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
        if (currentNoteIdOnDisk !== initialNoteIdFromState) {
            throw new Error(`Restore failed. Note's version control ID has changed or was removed. Expected "${initialNoteIdFromState}", found "${currentNoteIdOnDisk}".`);
        }

        await versionManager.saveNewVersionForFile(liveFile, `Backup before restoring V${versionId.substring(0,6)}...`, { force: true });
        const restoreSuccess = await versionManager.restoreVersion(liveFile, initialNoteIdFromState, versionId);
        
        if (restoreSuccess) {
            uiService.showNotice(`Successfully restored "${liveFile.basename}" to version ${versionId.substring(0,6)}...`);
        }
        dispatch(loadHistoryForNoteId(liveFile, initialNoteIdFromState));

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        console.error("Version Control: Error in restoreVersion thunk.", error);
        uiService.showNotice(`Restore failed: ${message}`, 7000);
        dispatch(initializeView(app.workspace.activeLeaf));
    } finally {
        backgroundTaskManager.manageWatchModeInterval();
    }
};

export const requestDelete = (version: VersionHistoryEntry): Thunk => (dispatch, getState) => {
    const state = getState();
    if (state.status !== AppStatus.READY) return;

    const isLastVersion = state.history.length === 1 && state.history[0].id === version.id;
    const versionLabel = version.name ? `"${version.name}" (V${version.versionNumber})` : `Version ${version.versionNumber}`;
    let message = `Are you sure you want to permanently delete ${versionLabel} for "${state.file.basename}"? This action cannot be undone.`;
    if (isLastVersion) {
        message += ` This is the last version. Deleting it will also remove the note from version control (its ${NOTE_FRONTMATTER_KEY} will be cleared).`;
    }

    dispatch(actions.openConfirmation({
        title: "Confirm Delete Version",
        message: message,
        onConfirmAction: deleteVersion(version.id),
    }));
};

export const deleteVersion = (versionId: string): Thunk => async (dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const noteManager = container.resolve<NoteManager>(SERVICE_NAMES.NOTE_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const app = container.resolve<App>(SERVICE_NAMES.APP);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY) return;
    const { file: initialFileFromState, noteId: initialNoteIdFromState, history: initialHistory } = initialState;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        if (!initialNoteIdFromState) {
             throw new Error("Cannot delete version. Note ID is missing from current context.");
        }

        const liveFile = app.vault.getAbstractFileByPath(initialFileFromState.path);
        if (liveFile instanceof TFile) {
            const currentNoteIdOnDisk = await noteManager.getNoteId(liveFile);
            if (currentNoteIdOnDisk !== initialNoteIdFromState && currentNoteIdOnDisk !== null) {
                throw new Error(`Delete failed. Note's version control ID has changed. Expected "${initialNoteIdFromState}", found "${currentNoteIdOnDisk}".`);
            }
        }

        const success = await versionManager.deleteVersion(initialNoteIdFromState, versionId);
        if (success) {
            const wasLastVersion = initialHistory.length === 1 && initialHistory[0].id === versionId;
            if (wasLastVersion) {
                uiService.showNotice(`Last version deleted. "${initialFileFromState.basename}" is no longer under version control.`);
                dispatch(initializeView(app.workspace.activeLeaf));
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
        dispatch(initializeView(app.workspace.activeLeaf));
    }
};

export const requestDeleteAll = (): Thunk => (dispatch, getState) => {
    const state = getState();
    if (state.status !== AppStatus.READY) return;

    dispatch(actions.openConfirmation({
        title: "Confirm Delete All Versions",
        message: `This will permanently delete all version history for "${state.file.basename}" and remove it from version control (its ${NOTE_FRONTMATTER_KEY} will be cleared). This action cannot be undone. Are you sure?`,
        onConfirmAction: deleteAllVersions(),
    }));
};

export const deleteAllVersions = (): Thunk => async (dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const app = container.resolve<App>(SERVICE_NAMES.APP);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY) return;
    const { file: initialFileFromState, noteId: initialNoteIdFromState } = initialState;

    dispatch(actions.setProcessing(true));
    dispatch(actions.closePanel());

    try {
        if (!initialNoteIdFromState) {
            throw new Error("No versions to delete or note ID is missing.");
        }
        const success = await versionManager.deleteAllVersions(initialNoteIdFromState);
        if (success) {
            uiService.showNotice(`All versions for "${initialFileFromState.basename}" have been deleted.`);
            dispatch(initializeView(app.workspace.activeLeaf));
        } else {
            throw new Error(`Failed to delete all versions for "${initialFileFromState.basename}".`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        console.error("Version Control: Error in deleteAllVersions thunk.", error);
        uiService.showNotice(`Delete all failed: ${message}`, 7000);
        dispatch(initializeView(app.workspace.activeLeaf));
    }
};
