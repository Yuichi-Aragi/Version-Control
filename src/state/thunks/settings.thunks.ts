import { App, normalizePath, TFolder } from 'obsidian';
import { produce } from 'immer';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionControlSettings, VersionHistoryEntry, VersionData } from '../../types';
import { AppStatus, type ActionItem } from '../state';
import { customSanitizeFileName } from '../../utils/file';
import { UIService } from '../../services/ui-service';
import { ManifestManager } from '../../core/manifest-manager';
import { ExportManager } from '../../services/export-manager';
import { VersionManager } from '../../core/version-manager';
import { BackgroundTaskManager } from '../../core/tasks/BackgroundTaskManager';
import { KeyUpdateManager } from '../../core/tasks/KeyUpdateManager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';
import { initializeView, loadEffectiveSettingsForNote } from './core.thunks';
import { VersionControlSettingsSchema } from '../../schemas';

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

export const requestKeyUpdate = (newKeyRaw: string): AppThunk => (dispatch, _getState, container) => {
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

    dispatch(actions.openPanel({
        type: 'confirmation',
        title: 'Update Frontmatter Key?',
        message: `This will update the frontmatter key from "${oldKey}" to "${newKey}" in all tracked notes and their version histories. This operation can take some time and is irreversible. Are you sure?`,
        onConfirmAction: confirmKeyUpdate(oldKey, newKey),
    }));
};

const confirmKeyUpdate = (oldKey: string, newKey: string): AppThunk => async (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const keyUpdateManager = container.get<KeyUpdateManager>(TYPES.KeyUpdateManager);
    
    dispatch(actions.closePanel());
    
    // This is a fire-and-forget call. The manager will dispatch progress updates.
    keyUpdateManager.updateAllKeys(oldKey, newKey);

    // Immediately update the setting so new operations use the new key.
    dispatch(updateGlobalSettings({ noteIdFrontmatterKey: newKey }));
};


export const toggleGlobalSettings = (applyGlobally: boolean): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("A versioned note must be active to change this setting.", 4000);
        return;
    }
    const { noteId } = state;

    try {
        if (applyGlobally) {
            await manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[manifest.currentBranch];
                if (branch) {
                    branch.settings = { isGlobal: true };
                }
            });
            dispatch(loadEffectiveSettingsForNote(noteId));
            uiService.showNotice("Note now follows global settings.", 3000);
        } else {
            const currentGlobalSettings = plugin.settings;
            await manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[manifest.currentBranch];
                if (branch) {
                    const { databasePath, centralManifest, autoRegisterNotes, pathFilters, noteIdFrontmatterKey, keyUpdatePathFilters, ...localSettings } = currentGlobalSettings;
                    branch.settings = { ...localSettings, isGlobal: false };
                }
            });
            dispatch(loadEffectiveSettingsForNote(noteId));
            uiService.showNotice("Note now has its own independent settings.", 3000);
        }
    } catch (error) {
        console.error(`VC: Failed to toggle global settings for note ${noteId}.`, error);
        uiService.showNotice("Failed to update settings. Please try again.", 5000);
        dispatch(loadEffectiveSettingsForNote(noteId));
    }
};

export const updateSettings = (settingsUpdate: Partial<VersionControlSettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const stateBeforeUpdate = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (stateBeforeUpdate.isRenaming) {
        uiService.showNotice("Cannot change settings while database is being renamed.");
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const { noteId, file } = stateBeforeUpdate;
    const isUnderGlobalInfluence = stateBeforeUpdate.settings.isGlobal;

    // Validate the proposed update against the schema
    const validationResult = VersionControlSettingsSchema.partial().safeParse(settingsUpdate);
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
    dispatch(actions.updateSettings(settingsUpdate));
    backgroundTaskManager.syncWatchMode();

    try {
        if (isUnderGlobalInfluence) {
            dispatch(updateGlobalSettings(settingsUpdate));
        } else {
            if (!noteId) {
                throw new Error("Cannot save per-note settings without an active note ID.");
            }
            await manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[manifest.currentBranch];
                if (branch) {
                    if (!branch.settings) branch.settings = {};
                    branch.settings.isGlobal = false;
                    Object.assign(branch.settings, settingsUpdate);
                }
            });
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
        await app.vault.adapter.rename(oldPath, newPath);

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

        uiService.showNotice(`Preparing to export V${versionEntry.versionNumber} of "${currentNoteName}"...`, 3000);
        
        const content = await versionManager.getVersionContent(versionEntry.noteId, versionEntry.id);
        if (content === null) {
            throw new Error(`Could not load content for version V${versionEntry.versionNumber}.`);
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
            const versionIdSuffix = versionData.name ? customSanitizeFileName(versionData.name) : `V${versionData.versionNumber}`;
            const exportFileName = `Version - ${sanitizedNoteName} - ${versionIdSuffix}.${format}`;
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
