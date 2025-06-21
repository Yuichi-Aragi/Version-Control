import { Notice, TFile } from 'obsidian';
import { Thunk } from './store';
import { actions } from './actions';
import { VersionHistoryEntry } from '../types';

/**
 * Thunks are action creators that return a function instead of an action object.
 * This function receives the store's dispatch and getState methods, and the plugin instance,
 * allowing for asynchronous logic and side effects. They are the sole entry point for
 * complex logic and interactions with the plugin's core services.
 */

export const thunks = {
    /**
     * Checks the currently active file in Obsidian and updates the state accordingly.
     * If a new note is active, it loads its version history. This is the primary
     * thunk for keeping the view in sync with the workspace.
     */
    updateActiveNote: (): Thunk => async (dispatch, getState, plugin) => {
        try {
            const newState = await plugin.noteManager.getActiveNoteState();
            const currentState = getState().activeNote;

            // Exit if the file and noteId are identical to the current state.
            if (newState.file?.path === currentState.file?.path && newState.noteId === currentState.noteId) {
                return;
            }

            // If no file is active, clear the view to show the placeholder.
            if (!newState.file) {
                dispatch(actions.clearActiveNote());
                return;
            }

            // A file is active. Set it in the state.
            // This ensures the file context is available even if there's no history yet.
            dispatch(actions.setActiveNote(newState));

            if (newState.noteId && newState.file) {
                // Self-healing: Verify that the path stored in the manifest matches the file's current path.
                // This catches cases where a file was renamed while Obsidian was closed.
                const noteManifest = await plugin.manifestManager.loadNoteManifest(newState.noteId);
                if (noteManifest && noteManifest.notePath !== newState.file.path) {
                    console.warn(`Version Control: Path mismatch found for ${newState.file.basename}. Manifest has "${noteManifest.notePath}", file is at "${newState.file.path}". Correcting.`);
                    await plugin.manifestManager.updateNotePath(newState.noteId, newState.file.path);
                    plugin.noteManager.invalidateCentralManifestCache();
                }

                // If the file has a version control ID, load its history.
                dispatch(thunks.loadHistory(newState.noteId));
            } else {
                // If the file has no ID, it's not versioned yet.
                // Show the history view with an empty list, allowing the user to save the first version.
                dispatch(actions.loadHistorySuccess([]));
            }
        } catch (error) {
            console.error("Version Control: Failed to update active note state.", error);
            new Notice("Error updating active note. Check console for details.");
            dispatch(actions.clearActiveNote());
        }
    },

    /**
     * Loads the version history for a given note ID. It dispatches actions to
     * manage the loading UI state and handles potential errors gracefully.
     */
    loadHistory: (noteId: string): Thunk => async (dispatch, getState, plugin) => {
        dispatch(actions.loadHistoryStart());
        try {
            const history = await plugin.versionManager.getVersionHistory(noteId);
            dispatch(actions.loadHistorySuccess(history));
        } catch (error) {
            console.error("Version Control: Failed to load version history", error);
            new Notice("Error: Could not load version history.");
            dispatch(actions.loadHistorySuccess([])); // Clear loading state on error
        }
    },

    /**
     * Saves a new version of the currently active note. After a successful save,
     * it reloads the history to reflect the new version immediately.
     */
    saveNewVersion: (name?: string): Thunk => async (dispatch, getState, plugin) => {
        dispatch(actions.setProcessingState(true));
        try {
            const { file } = getState().activeNote;
            if (!file) {
                new Notice("No active file to save a version for.");
                return;
            }

            // Re-verify that the file still exists in the vault, as the state might be stale.
            const currentFile = plugin.app.vault.getAbstractFileByPath(file.path);
            if (!(currentFile instanceof TFile)) {
                new Notice(`Cannot save version: The note "${file.basename}" no longer exists.`);
                dispatch(thunks.updateActiveNote()); // Refresh state to clear the view
                return;
            }

            // Show loading state on the history list while saving
            dispatch(actions.loadHistoryStart());

            const success = await plugin.versionManager.saveNewVersion(currentFile, name);
            if (success) {
                // After saving, get the new noteId (it might have been created) and reload history
                const newNoteId = await plugin.noteManager.getNoteId(currentFile);
                if (newNoteId) {
                    // Ensure the active note state is up-to-date before loading history
                    if (getState().activeNote.noteId !== newNoteId) {
                        dispatch(actions.setActiveNote({ file: currentFile, noteId: newNoteId }));
                    }
                    dispatch(thunks.loadHistory(newNoteId));
                } else {
                    // This case is unlikely if saving succeeded, but as a fallback:
                    new Notice("Version saved, but could not re-read note ID to refresh history.");
                    dispatch(actions.loadHistorySuccess([]));
                }
            } else {
                // If saving failed, the version manager already showed a notice.
                // Reload the original history to clear the loading state.
                const { noteId } = getState().activeNote;
                if (noteId) {
                    dispatch(thunks.loadHistory(noteId));
                } else {
                    dispatch(actions.loadHistorySuccess([]));
                }
            }
        } catch (error) {
            console.error("Version Control: Unhandled error in saveNewVersion thunk.", error);
            new Notice("An unexpected error occurred while saving. Check console.");
            const { noteId } = getState().activeNote;
            if (noteId) dispatch(thunks.loadHistory(noteId));
        } finally {
            dispatch(actions.setProcessingState(false));
        }
    },

    /**
     * Shows a confirmation dialog for restoring a version. This encapsulates the UI
     * flow for a destructive action, ensuring user confirmation.
     */
    requestRestore: (version: VersionHistoryEntry): Thunk => (dispatch) => {
        dispatch(actions.showConfirmation({
            title: "Restore Version?",
            message: `This will overwrite the current note content with Version ${version.versionNumber}. A backup of the current content will be saved first.`,
            onConfirmAction: thunks.restoreVersion(version.id),
        }));
    },

    /**
     * Restores a specific version of the active note. This operation includes
     * creating a backup of the current content as a new version before overwriting the note.
     */
    restoreVersion: (versionId: string): Thunk => async (dispatch, getState, plugin) => {
        dispatch(actions.setProcessingState(true));
        dispatch(actions.hideConfirmation());

        try {
            const { file, noteId } = getState().activeNote;
            if (!file || !noteId) {
                new Notice("Cannot restore: active note context is lost.");
                return;
            }

            // Re-verify that the file still exists in the vault, as the state might be stale.
            const currentFile = plugin.app.vault.getAbstractFileByPath(file.path);
            if (!(currentFile instanceof TFile)) {
                new Notice(`Cannot restore: The note "${file.basename}" no longer exists.`);
                dispatch(thunks.updateActiveNote()); // Refresh state
                return;
            }

            // --- Orchestration Logic ---
            // 1. Create a backup of the current state before overwriting.
            try {
                const backupSaved = await plugin.versionManager.saveNewVersion(currentFile, `Backup before restoring ${versionId}`);
                if (!backupSaved) {
                    // If backup fails, we still proceed but warn the user.
                    new Notice("Warning: Could not create backup before restoration. Proceeding anyway.");
                }
            } catch (backupError) {
                console.error("Version Control: Failed to save backup before restoring.", backupError);
                new Notice("Warning: Backup creation failed. Proceeding with restoration.");
            }

            // 2. Perform the actual restoration.
            const success = await plugin.versionManager.restoreVersion(currentFile, noteId, versionId);
            
            // 3. Refresh the UI.
            const finalNoteId = getState().activeNote.noteId;
            if (finalNoteId) {
                // Always reload history to show the new state (e.g., the backup version and the restored content).
                dispatch(thunks.loadHistory(finalNoteId));
            } else if (!success) {
                // The version manager will have shown a notice.
                new Notice("Version restoration failed. See console for details.");
            }
        } catch (error) {
            console.error("Version Control: Unhandled error in restoreVersion thunk.", error);
            new Notice("An unexpected error occurred during restoration. Check console.");
            const { noteId } = getState().activeNote;
            if (noteId) dispatch(thunks.loadHistory(noteId));
        } finally {
            dispatch(actions.setProcessingState(false));
        }
    },

    /**
     * Shows a confirmation dialog for deleting a version.
     */
    requestDelete: (version: VersionHistoryEntry): Thunk => (dispatch, getState) => {
        const history = getState().activeNote.history;
        
        const isLastVersion = history.length === 1;
        const message = isLastVersion
            ? `Are you sure you want to permanently delete the last remaining version of this note? This cannot be undone.`
            : `Are you sure you want to permanently delete Version ${version.versionNumber}? This cannot be undone.`;

        dispatch(actions.showConfirmation({
            title: "Delete Version?",
            message: message,
            onConfirmAction: thunks.deleteVersion(version.id),
        }));
    },

    /**
     * Deletes a specific version of the active note.
     */
    deleteVersion: (versionId: string): Thunk => async (dispatch, getState, plugin) => {
        dispatch(actions.setProcessingState(true));
        dispatch(actions.hideConfirmation());
        try {
            const { noteId } = getState().activeNote;
            if (!noteId) return;

            const success = await plugin.versionManager.deleteVersion(noteId, versionId);
            if (success) {
                dispatch(thunks.loadHistory(noteId));
            } else {
                new Notice("Failed to delete version.");
            }
        } catch (error) {
            console.error("Version Control: Unhandled error in deleteVersion thunk.", error);
            new Notice("An unexpected error occurred while deleting. Check console.");
            const { noteId } = getState().activeNote;
            if (noteId) dispatch(thunks.loadHistory(noteId));
        } finally {
            dispatch(actions.setProcessingState(false));
        }
    },

    /**
     * Shows a confirmation dialog for deleting all versions of a note.
     */
    requestDeleteAll: (): Thunk => (dispatch, getState) => {
        const { file } = getState().activeNote;
        if (!file) return;
        dispatch(actions.showConfirmation({
            title: "Delete All Versions?",
            message: `This will permanently delete all versions of "${file.basename}". This cannot be undone.`,
            onConfirmAction: thunks.deleteAllVersions(),
        }));
    },

    /**
     * Deletes all versions of the active note.
     */
    deleteAllVersions: (): Thunk => async (dispatch, getState, plugin) => {
        dispatch(actions.setProcessingState(true));
        dispatch(actions.hideConfirmation());
        try {
            const { noteId, file } = getState().activeNote;
            if (!noteId || !file) return;

            // Re-verify that the file still exists in the vault.
            const currentFile = plugin.app.vault.getAbstractFileByPath(file.path);
            if (!(currentFile instanceof TFile)) {
                new Notice(`Cannot delete versions: The note "${file.basename}" no longer exists.`);
                dispatch(thunks.updateActiveNote()); // Refresh state
                return;
            }

            const success = await plugin.versionManager.deleteAllVersions(noteId);
            if (success) {
                // After deleting all, the note is no longer under version control,
                // but it's still the active note. We update the state to reflect this.
                dispatch(actions.setActiveNote({ file, noteId: null }));
                dispatch(actions.loadHistorySuccess([]));
            } else {
                new Notice("Failed to delete all versions.");
            }
        } catch (error) {
            console.error("Version Control: Unhandled error in deleteAllVersions thunk.", error);
            new Notice("An unexpected error occurred while deleting all versions. Check console.");
            const { noteId } = getState().activeNote;
            if (noteId) dispatch(thunks.loadHistory(noteId));
        } finally {
            dispatch(actions.setProcessingState(false));
        }
    },

    /**
     * Opens the preview panel for a specific version.
     */
    viewVersion: (version: VersionHistoryEntry): Thunk => async (dispatch, getState, plugin) => {
        const { noteId } = getState().activeNote;
        if (!noteId) return;

        const content = await plugin.versionManager.getVersionContent(noteId, version.id);
        if (content !== null) {
            dispatch(actions.showPreview({ version, content }));
        } else {
            new Notice("Error: Could not load version content.");
        }
    },

    /**
     * Creates a new note from a specific version (a "deviation").
     */
    createDeviation: (version: VersionHistoryEntry): Thunk => async (dispatch, getState, plugin) => {
        const success = await plugin.versionManager.createDeviation(version.noteId, version.id);
        if (!success) {
            new Notice("Failed to create note from version.");
        }
    },
};