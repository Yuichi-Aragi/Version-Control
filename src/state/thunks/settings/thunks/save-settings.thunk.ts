import { normalizePath } from 'obsidian';
import { produce } from 'immer';
import type { AppThunk, Services } from '@/state';
import { appSlice } from '@/state';
import type { VersionControlSettings } from '@/types';
import { shouldAbort } from '@/state/utils/guards';
import { initializeView } from '@/state/thunks/core.thunks';
import {
    validateGlobalSettings,
    validateFrontmatterKey,
    validateNoteIdFormat,
    validateVersionIdFormat,
    validateDatabasePath,
} from '@/state/thunks/settings/validation';
import { mergeGlobalSettings, updateLegacyKeys } from '@/state/thunks/settings/helpers';
import { historyApi } from '@/state/apis/history.api';

/**
 * Thunks for saving and updating settings.
 */

/**
 * Updates global settings with validation.
 *
 * @param settingsUpdate - Partial settings to update
 * @returns Async thunk
 */
export const updateGlobalSettings = (settingsUpdate: Partial<VersionControlSettings>): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const plugin = services.plugin;
    const uiService = services.uiService;
    const backgroundTaskManager = services.backgroundTaskManager;

    try {
        const newGlobalSettings = mergeGlobalSettings(plugin.settings, settingsUpdate);

        // Validate before saving
        const validationResult = validateGlobalSettings(newGlobalSettings);
        if (!validationResult.success) {
            throw new Error(validationResult.error);
        }

        plugin.settings = newGlobalSettings;
        await plugin.saveSettings();

        // Dispatch to update the UI state for any open note that is following global settings.
        dispatch(appSlice.actions.updateSettings(settingsUpdate));
        backgroundTaskManager.syncWatchMode();
        
        // Invalidate settings cache to force refresh in UI for all notes using global settings
        dispatch(historyApi.util.invalidateTags(['Settings']));
        
    } catch (error) {
        console.error(`VC: Failed to update global settings.`, error);
        uiService.showNotice("Failed to save global settings due to validation error.", 5000);
    }
};

/**
 * Requests a frontmatter key update with validation.
 *
 * @param newKeyRaw - The new frontmatter key (will be trimmed)
 * @returns Async thunk
 */
export const requestKeyUpdate = (newKeyRaw: string): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const plugin = services.plugin;
    const uiService = services.uiService;
    const oldKey = plugin.settings.noteIdFrontmatterKey;
    const newKey = newKeyRaw.trim();

    const validation = validateFrontmatterKey(newKey);
    if (!validation.success) {
        uiService.showNotice(validation.error ?? "Invalid frontmatter key.", 3000);
        return;
    }

    if (newKey === oldKey) {
        return;
    }

    // Update settings:
    // 1. Add old key to legacy keys (if not already there)
    // 2. Set new key as primary
    const currentLegacyKeys = plugin.settings.legacyNoteIdFrontmatterKeys;
    const updatedLegacyKeys = updateLegacyKeys(currentLegacyKeys, oldKey);

    dispatch(updateGlobalSettings({
        noteIdFrontmatterKey: newKey,
        legacyNoteIdFrontmatterKeys: updatedLegacyKeys
    }));

    uiService.showNotice(`Frontmatter key updated to "${newKey}". Legacy keys will be migrated lazily.`, 4000);
};

/**
 * Requests an update to ID formats with confirmation.
 *
 * @param newNoteIdFormat - The new note ID format
 * @param newVersionIdFormat - The new version ID format
 * @returns Thunk
 */
export const requestUpdateIdFormats = (newNoteIdFormat: string, newVersionIdFormat: string): AppThunk => (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const plugin = services.plugin;
    const uiService = services.uiService;

    const oldNoteIdFormat = plugin.settings.noteIdFormat;
    const oldVersionIdFormat = plugin.settings.versionIdFormat;

    if (newNoteIdFormat === oldNoteIdFormat && newVersionIdFormat === oldVersionIdFormat) {
        return;
    }

    // Validate inputs
    const noteIdValidation = validateNoteIdFormat(newNoteIdFormat);
    const versionIdValidation = validateVersionIdFormat(newVersionIdFormat);

    if (!noteIdValidation.success || !versionIdValidation.success) {
        uiService.showNotice("Invalid ID format settings.", 3000);
        return;
    }

    dispatch(appSlice.actions.openPanel({
        type: 'confirmation',
        title: 'Update ID Formats?',
        message: `You are about to change the ID generation formats. This will affect how new notes and versions are identified. Existing IDs will remain unchanged. \n\nNew Note ID Format: ${newNoteIdFormat}\nNew Version ID Format: ${newVersionIdFormat}\n\nAre you sure you want to apply these changes?`,
        onConfirmAction: confirmUpdateIdFormats(newNoteIdFormat, newVersionIdFormat),
    }));
};

/**
 * Confirms and applies ID format updates.
 *
 * @param newNoteIdFormat - The new note ID format
 * @param newVersionIdFormat - The new version ID format
 * @returns Async thunk
 */
const confirmUpdateIdFormats = (newNoteIdFormat: string, newVersionIdFormat: string): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    dispatch(appSlice.actions.closePanel());
    dispatch(updateGlobalSettings({
        noteIdFormat: newNoteIdFormat,
        versionIdFormat: newVersionIdFormat
    }));
};

/**
 * Renames the database path with validation and rollback support.
 *
 * @param newPathRaw - The new database path (will be normalized and trimmed)
 * @returns Async thunk
 */
export const renameDatabasePath = (newPathRaw: string): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const app = services.app;
    const uiService = services.uiService;
    const manifestManager = services.manifestManager;
    const plugin = services.plugin;
    const storageService = services.storageService;

    const state = getState().app;
    if (state.isRenaming) {
        uiService.showNotice("A rename operation is already in progress.");
        return;
    }

    const oldPath = plugin.settings.databasePath;
    const newPath = normalizePath(newPathRaw.trim());

    const validation = validateDatabasePath(newPath);
    if (!validation.success) {
        uiService.showNotice(validation.error ?? "Invalid database path.", 3000);
        return;
    }

    if (oldPath === newPath) {
        return;
    }

    const existingItem = app.vault.getAbstractFileByPath(newPath);
    if (existingItem) {
        uiService.showNotice(`Cannot move database: an item already exists at "${newPath}".`, 5000);
        return;
    }

    dispatch(appSlice.actions.setRenaming(true));
    uiService.showNotice(`Renaming database to "${newPath}"... Please wait.`);

    try {
        // Use StorageService for robust renaming with false-positive mitigation
        await storageService.renameFolder(oldPath, newPath);

        const oldManifest = plugin.settings.centralManifest;
        const newManifest = produce(oldManifest, draft => {
            for (const noteId in draft.notes) {
                const noteEntry = draft.notes[noteId];
                if (noteEntry) {
                    noteEntry.manifestPath = normalizePath(noteEntry.manifestPath.replace(oldPath, newPath));
                }
            }
        });

        plugin.settings.databasePath = newPath;
        plugin.settings.centralManifest = newManifest;

        await plugin.saveSettings();

        dispatch(appSlice.actions.updateSettings({ databasePath: newPath, centralManifest: newManifest }));

        manifestManager.invalidateCentralManifestCache();

        uiService.showNotice(`Database successfully moved to "${newPath}".`, 5000);

        dispatch(initializeView(undefined));

    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`VC: Failed to rename database from "${oldPath}" to "${newPath}".`, error);
        uiService.showNotice(`Failed to move database: ${message}. Attempting to revert.`, 7000);

        const newPathExists = await app.vault.adapter.exists(newPath);
        if (newPathExists) {
            try {
                // We use adapter directly here as this is a critical revert operation where we want explicit control
                await app.vault.adapter.rename(newPath, oldPath);
                uiService.showNotice("Reverted database move. Please check your vault.", 5000);
            } catch (revertError) {
                uiService.showNotice(`CRITICAL: Failed to revert database move. The database may be at "${newPath}". Manual correction needed.`, 0);
            }
        }
    } finally {
        if (!shouldAbort(services, getState)) {
            dispatch(appSlice.actions.setRenaming(false));
        }
    }
};
