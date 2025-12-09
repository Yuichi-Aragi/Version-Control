import { App, normalizePath, TFolder } from 'obsidian';
import { produce } from 'immer';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionControlSettings, VersionHistoryEntry, VersionData, HistorySettings } from '../../types';
import { AppStatus, type ActionItem } from '../state';
import { customSanitizeFileName } from '../../utils/file';
import { UIService } from '../../services/ui-service';
import { ManifestManager } from '../../core/manifest-manager';
import { EditHistoryManager } from '../../core/edit-history-manager';
import { ExportManager } from '../../services/export-manager';
import { VersionManager } from '../../core/version-manager';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from '../utils/settingsUtils';
import type VersionControlPlugin from '../../main';
import { initializeView, loadEffectiveSettingsForNote } from './core.thunks';
import { VersionControlSettingsSchema, HistorySettingsSchema } from '../../schemas';
import { StorageService } from '../../core/storage/storage-service';

/**
 * Thunks for updating settings and handling export functionality.
 */

export const updateGlobalSettings = (settingsUpdate: Partial<VersionControlSettings>): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const uiService = container.get<UIService>(TYPES.UIService);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    try {
        const newGlobalSettings = { ...plugin.settings, ...settingsUpdate };
        
        // Validate before saving
        VersionControlSettingsSchema.parse(newGlobalSettings);

        plugin.settings = newGlobalSettings;
        await plugin.saveSettings();

        // Dispatch to update the UI state for any open note that is following global settings.
        dispatch(actions.updateSettings(settingsUpdate));
        backgroundTaskManager.syncWatchMode();
    } catch (error) {
        console.error(`VC: Failed to update global settings.`, error);
        uiService.showNotice("Failed to save global settings due to validation error.", 5000);
    }
};

export const requestKeyUpdate = (newKeyRaw: string): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const uiService = container.get<UIService>(TYPES.UIService);
    const oldKey = plugin.settings.noteIdFrontmatterKey;
    const newKey = newKeyRaw.trim();

    const validation = VersionControlSettingsSchema.shape.noteIdFrontmatterKey.safeParse(newKey);
    if (!validation.success) {
        uiService.showNotice(validation.error.issues[0]?.message ?? "Invalid frontmatter key.", 3000);
        return;
    }

    if (newKey === oldKey) {
        return;
    }

    // Update settings:
    // 1. Add old key to legacy keys (if not already there)
    // 2. Set new key as primary
    const currentLegacyKeys = plugin.settings.legacyNoteIdFrontmatterKeys || [];
    const updatedLegacyKeys = Array.from(new Set([...currentLegacyKeys, oldKey]));

    dispatch(updateGlobalSettings({
        noteIdFrontmatterKey: newKey,
        legacyNoteIdFrontmatterKeys: updatedLegacyKeys
    }));

    uiService.showNotice(`Frontmatter key updated to "${newKey}". Legacy keys will be migrated lazily.`, 4000);
};

export const requestUpdateIdFormats = (newNoteIdFormat: string, newVersionIdFormat: string): AppThunk => (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const uiService = container.get<UIService>(TYPES.UIService);

    const oldNoteIdFormat = plugin.settings.noteIdFormat;
    const oldVersionIdFormat = plugin.settings.versionIdFormat;

    if (newNoteIdFormat === oldNoteIdFormat && newVersionIdFormat === oldVersionIdFormat) {
        return;
    }

    // Validate inputs
    const noteIdValidation = VersionControlSettingsSchema.shape.noteIdFormat.safeParse(newNoteIdFormat);
    const versionIdValidation = VersionControlSettingsSchema.shape.versionIdFormat.safeParse(newVersionIdFormat);

    if (!noteIdValidation.success || !versionIdValidation.success) {
        uiService.showNotice("Invalid ID format settings.", 3000);
        return;
    }

    dispatch(actions.openPanel({
        type: 'confirmation',
        title: 'Update ID Formats?',
        message: `You are about to change the ID generation formats. This will affect how new notes and versions are identified. Existing IDs will remain unchanged. \n\nNew Note ID Format: ${newNoteIdFormat}\nNew Version ID Format: ${newVersionIdFormat}\n\nAre you sure you want to apply these changes?`,
        onConfirmAction: confirmUpdateIdFormats(newNoteIdFormat, newVersionIdFormat),
    }));
};

const confirmUpdateIdFormats = (newNoteIdFormat: string, newVersionIdFormat: string): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    dispatch(actions.closePanel());
    dispatch(updateGlobalSettings({ 
        noteIdFormat: newNoteIdFormat, 
        versionIdFormat: newVersionIdFormat 
    }));
};

export const toggleGlobalSettings = (applyGlobally: boolean): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("A versioned note must be active to change this setting.", 4000);
        return;
    }
    const { noteId, viewMode } = state;

    try {
        if (viewMode === 'versions') {
            if (applyGlobally) {
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        branch.settings = { isGlobal: true };
                    }
                });
                uiService.showNotice("Note versions now follow global settings.", 3000);
            } else {
                const globalVersionDefaults = plugin.settings.versionHistorySettings;
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        branch.settings = { ...globalVersionDefaults, isGlobal: false };
                    }
                });
                uiService.showNotice("Note versions now have independent settings.", 3000);
            }
        } else {
            // Edit Mode
            let editManifest = await editHistoryManager.getEditManifest(noteId);
            if (!editManifest) {
                // Should exist if we are viewing edits, but just in case
                uiService.showNotice("Edit history not initialized.", 3000);
                return;
            }
            
            if (applyGlobally) {
                editManifest.branches[editManifest.currentBranch]!.settings = { isGlobal: true };
            } else {
                const globalEditDefaults = plugin.settings.editHistorySettings;
                editManifest.branches[editManifest.currentBranch]!.settings = { ...globalEditDefaults, isGlobal: false };
            }
            await editHistoryManager.saveEditManifest(noteId, editManifest);
            uiService.showNotice(`Note edits now ${applyGlobally ? 'follow global' : 'have independent'} settings.`, 3000);
        }
        
        dispatch(loadEffectiveSettingsForNote(noteId));
        
    } catch (error) {
        console.error(`VC: Failed to toggle global settings for note ${noteId}.`, error);
        uiService.showNotice("Failed to update settings. Please try again.", 5000);
        dispatch(loadEffectiveSettingsForNote(noteId));
    }
};

export const updateSettings = (settingsUpdate: Partial<HistorySettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const stateBeforeUpdate = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (stateBeforeUpdate.isRenaming) {
        uiService.showNotice("Cannot change settings while database is being renamed.");
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const { noteId, file, viewMode } = stateBeforeUpdate;
    const isUnderGlobalInfluence = stateBeforeUpdate.effectiveSettings.isGlobal;

    // Validate the proposed update against the schema
    const validationResult = HistorySettingsSchema.partial().safeParse(settingsUpdate);
    if (!validationResult.success) {
        console.error("VC: Invalid settings update.", validationResult.error);
        uiService.showNotice("Failed to save settings: Invalid data.", 5000);
        return;
    }

    if (file && (settingsUpdate.hasOwnProperty('autoSaveOnSaveInterval') || settingsUpdate.hasOwnProperty('autoSaveOnSave'))) {
        const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);
        debouncerInfo?.debouncer.cancel();
        plugin.autoSaveDebouncers.delete(file.path);
    }
    
    // Optimistic UI update
    dispatch(actions.updateEffectiveSettings({ ...stateBeforeUpdate.effectiveSettings, ...settingsUpdate }));
    backgroundTaskManager.syncWatchMode();

    try {
        if (isUnderGlobalInfluence) {
            // Update Global Settings based on view mode
            if (viewMode === 'versions') {
                const newVersionSettings = { ...plugin.settings.versionHistorySettings, ...settingsUpdate };
                dispatch(updateGlobalSettings({ versionHistorySettings: newVersionSettings }));
            } else {
                const newEditSettings = { ...plugin.settings.editHistorySettings, ...settingsUpdate };
                dispatch(updateGlobalSettings({ editHistorySettings: newEditSettings }));
            }
        } else {
            if (!noteId) {
                throw new Error("Cannot save per-note settings without an active note ID.");
            }
            // Update Per-Note Settings
            if (viewMode === 'versions') {
                await manifestManager.updateNoteManifest(noteId, (manifest) => {
                    const branch = manifest.branches[manifest.currentBranch];
                    if (branch) {
                        if (!branch.settings) branch.settings = {};
                        branch.settings.isGlobal = false;
                        Object.assign(branch.settings, settingsUpdate);
                    }
                });
            } else {
                const editManifest = await editHistoryManager.getEditManifest(noteId);
                if (editManifest) {
                    const branch = editManifest.branches[editManifest.currentBranch];
                    if (branch) {
                        if (!branch.settings) branch.settings = {};
                        branch.settings.isGlobal = false;
                        Object.assign(branch.settings, settingsUpdate);
                        await editHistoryManager.saveEditManifest(noteId, editManifest);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`VC: Failed to update settings. Reverting UI.`, error);
        uiService.showNotice("Failed to save settings. Reverting.", 5000);
        dispatch(loadEffectiveSettingsForNote(noteId));
    }
};

export const renameDatabasePath = (newPathRaw: string): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const app = container.get<App>(TYPES.App);
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const storageService = container.get<StorageService>(TYPES.StorageService);

    const state = getState();
    if (state.isRenaming) {
        uiService.showNotice("A rename operation is already in progress.");
        return;
    }

    const oldPath = plugin.settings.databasePath;
    const newPath = normalizePath(newPathRaw.trim());
    
    const validation = VersionControlSettingsSchema.shape.databasePath.safeParse(newPath);
    if (!validation.success) {
        uiService.showNotice(validation.error.issues[0]?.message ?? "Invalid database path.", 3000);
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

    dispatch(actions.setRenaming(true));
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

        dispatch(actions.updateSettings({ databasePath: newPath, centralManifest: newManifest }));

        manifestManager.invalidateCentralManifestCache();

        uiService.showNotice(`Database successfully moved to "${newPath}".`, 5000);

        dispatch(initializeView());

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
        if (!isPluginUnloading(container)) {
            dispatch(actions.setRenaming(false));
        }
    }
};

export const requestExportAllVersions = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (state.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("VC: Cannot export because the note is not ready or is not under version control.", 3000);
        return;
    }
    const noteId = state.noteId;

    const formats: Array<'md' | 'json' | 'ndjson' | 'txt'> = ['md', 'json', 'ndjson', 'txt'];
    const items: ActionItem<'md' | 'json' | 'ndjson' | 'txt'>[] = formats.map(format => ({
        id: format,
        data: format,
        text: `Export all versions as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
    }));

    const onChooseAction = (format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => (dispatch) => {
        dispatch(exportAllVersions(noteId, format));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Choose export format',
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const exportAllVersions = (noteId: string, format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const initialState = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const exportManager = container.get<ExportManager>(TYPES.ExportManager);
    const app = container.get<App>(TYPES.App);

    if (initialState.status !== AppStatus.READY || initialState.noteId !== noteId) {
        uiService.showNotice("VC: Export cancelled because the view context changed.", 3000);
        return;
    }
    dispatch(actions.setProcessing(true));
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) {
            throw new Error(`Export failed: Could not find manifest for note ID ${noteId}.`);
        }
        const currentNoteName = noteManifest.notePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';

        uiService.showNotice(`Preparing to export all versions for "${currentNoteName}"...`, 3000);

        const versionsData = await exportManager.getAllVersionsData(noteId);
        if (versionsData.length === 0) {
            uiService.showNotice(`No versions found for "${currentNoteName}" to export.`, 3000);
            return;
        }

        const exportContent = exportManager.formatExportData(versionsData, format);
        if (exportContent === null) {
            throw new Error(`Failed to format data for export in ${format} format.`);
        }

        const folders = app.vault.getAllFolders();
        const folderItems: ActionItem<TFolder>[] = folders.map(folder => ({
            id: folder.path,
            data: folder,
            text: folder.isRoot() ? "/" : folder.path,
        }));

        const onChooseFolder = (selectedFolder: TFolder): AppThunk => async (dispatch, _getState) => {
            dispatch(actions.closePanel()); // Close the folder selection panel immediately.

            const latestState = getState();
            if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
                uiService.showNotice("VC: Export cancelled because the note context changed during folder selection.");
                return;
            }
            const sanitizedNoteName = customSanitizeFileName(currentNoteName);
            const exportFileName = `Version History - ${sanitizedNoteName}.${format}`;
            const exportFilePath = await exportManager.writeFile(selectedFolder, exportFileName, exportContent);
            uiService.showNotice(`Successfully exported to ${exportFilePath}`, 7000);
        };

        dispatch(actions.openPanel({
            type: 'action',
            title: 'Export to folder...',
            items: folderItems,
            onChooseAction: onChooseFolder,
            showFilter: true,
        }));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Version Control: Export failed for all versions of note ID ${noteId.substring(0,8)}...`, error);
        uiService.showNotice(`Error: Failed to export all versions. ${errorMessage}.`, 7000);
    } finally {
        const finalState = getState();
        if (finalState.status === AppStatus.READY) {
            dispatch(actions.setProcessing(false));
        }
    }
};

export const requestExportSingleVersion = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (state.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot export version because the view context is not ready or has changed.", 3000);
        return;
    }

    const formats: Array<'md' | 'json' | 'ndjson' | 'txt'> = ['md', 'json', 'ndjson', 'txt'];
    const items: ActionItem<'md' | 'json' | 'ndjson' | 'txt'>[] = formats.map(format => ({
        id: format,
        data: format,
        text: `Export version as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
    }));

    const onChooseAction = (format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => (dispatch) => {
        dispatch(exportSingleVersion(version, format));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: `Export V${version.versionNumber}`,
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const exportSingleVersion = (versionEntry: VersionHistoryEntry, format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const initialState = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
    const exportManager = container.get<ExportManager>(TYPES.ExportManager);
    const app = container.get<App>(TYPES.App);

    if (initialState.status !== AppStatus.READY || initialState.noteId !== versionEntry.noteId) {
        uiService.showNotice("VC: Export cancelled because the view context changed.", 3000);
        return;
    }
    dispatch(actions.setProcessing(true));
    try {
        const noteManifest = await manifestManager.loadNoteManifest(versionEntry.noteId);
        if (!noteManifest) {
            throw new Error(`Manifest for note ID ${versionEntry.noteId} not found.`);
        }
        const currentNoteName = noteManifest.notePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        const viewMode = getState().viewMode;

        uiService.showNotice(`Preparing to export V${versionEntry.versionNumber} of "${currentNoteName}"...`, 3000);
        
        let content: string | null = null;
        if (viewMode === 'versions') {
             content = await versionManager.getVersionContent(versionEntry.noteId, versionEntry.id);
        } else {
             content = await editHistoryManager.getEditContent(versionEntry.noteId, versionEntry.id);
        }

        if (content === null) {
            throw new Error(`Could not load content for ${viewMode === 'versions' ? 'version' : 'edit'}.`);
        }
        
        const versionData: VersionData = {
            id: versionEntry.id,
            noteId: versionEntry.noteId,
            notePath: versionEntry.notePath,
            branchName: versionEntry.branchName,
            versionNumber: versionEntry.versionNumber,
            timestamp: versionEntry.timestamp,
            name: versionEntry.name ?? '',
            size: versionEntry.size,
            content: content,
        };
        
        const exportContent = exportManager.formatExportData([versionData], format);
        if (exportContent === null) {
            throw new Error(`Failed to format data for export in ${format} format.`);
        }

        const folders = app.vault.getAllFolders();
        const folderItems: ActionItem<TFolder>[] = folders.map(folder => ({
            id: folder.path,
            data: folder,
            text: folder.isRoot() ? "/" : folder.path,
        }));

        const onChooseFolder = (selectedFolder: TFolder): AppThunk => async (dispatch, _getState) => {
            dispatch(actions.closePanel()); // Close the folder selection panel immediately.

            const latestState = getState();
            if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
                uiService.showNotice("VC: Export cancelled because the note context changed during folder selection.");
                return;
            }
            
            const sanitizedNoteName = customSanitizeFileName(currentNoteName);
            const typeLabel = viewMode === 'versions' ? 'Version' : 'Edit';
            const idLabel = viewMode === 'versions' ? `V${versionData.versionNumber}` : `Edit ${versionData.versionNumber}`;
            const versionIdSuffix = versionData.name ? customSanitizeFileName(versionData.name) : customSanitizeFileName(idLabel);
            const exportFileName = `${typeLabel} - ${sanitizedNoteName} - ${versionIdSuffix}.${format}`;
            const exportFilePath = await exportManager.writeFile(selectedFolder, exportFileName, exportContent);
            
            uiService.showNotice(`Successfully exported to ${exportFilePath}`, 7000);
        };

        dispatch(actions.openPanel({
            type: 'action',
            title: 'Export to folder...',
            items: folderItems,
            onChooseAction: onChooseFolder,
            showFilter: true,
        }));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Version Control: Export failed for version V${versionEntry.versionNumber} of note ID ${versionEntry.noteId.substring(0,8)}...`, error);
        uiService.showNotice(`Error: Failed to export version. ${errorMessage}.`, 7000);
    } finally {
        const finalState = getState();
        if (finalState.status === AppStatus.READY) {
            dispatch(actions.setProcessing(false));
        }
    }
};
