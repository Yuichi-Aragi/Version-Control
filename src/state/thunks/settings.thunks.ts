import { App, normalizePath } from 'obsidian';
import { produce } from 'immer';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionControlSettings, VersionHistoryEntry, VersionData } from '../../types';
import { AppStatus } from '../state';
import { customSanitizeFileName } from '../../utils/file';
import { UIService } from '../../services/ui-service';
import { ManifestManager } from '../../core/manifest-manager';
import { ExportManager } from '../../services/export-manager';
import { VersionManager } from '../../core/version-manager';
import { BackgroundTaskManager } from '../../core/BackgroundTaskManager';
import { TYPES } from '../../types/inversify.types';
import { DEFAULT_SETTINGS } from '../../constants';
import { isPluginUnloading } from './ThunkUtils';
import type VersionControlPlugin from '../../main';
import { initializeView } from './core.thunks';

/**
 * Thunks for updating settings and handling export functionality.
 */

export const updateSettings = (settingsUpdate: Partial<Omit<VersionControlSettings, 'databasePath' | 'centralManifest'>>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();
    const uiService = container.get<UIService>(TYPES.UIService);
    if (state.isRenaming) {
        uiService.showNotice("Cannot change settings while database is being renamed.");
        return;
    }

    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const stateBeforeUpdate = getState();
    
    const originalSettings = (Object.keys(settingsUpdate) as Array<keyof typeof settingsUpdate>)
        .reduce((acc, key) => ({
            ...acc,
            [key]: stateBeforeUpdate.settings[key]
        }), {} as Partial<VersionControlSettings>);

    if (stateBeforeUpdate.status !== AppStatus.READY || !stateBeforeUpdate.noteId || !stateBeforeUpdate.file) {
        uiService.showNotice("A note with version history must be active to change its settings.", 5000);
        return;
    }
    const { noteId, file } = stateBeforeUpdate;

    if (settingsUpdate.hasOwnProperty('autoSaveOnSaveInterval') || settingsUpdate.hasOwnProperty('autoSaveOnSave')) {
        const debouncerInfo = plugin.autoSaveDebouncers.get(file.path);
        if (debouncerInfo) {
            debouncerInfo.debouncer.cancel();
            plugin.autoSaveDebouncers.delete(file.path);
        }
    }

    dispatch(actions.updateSettings(settingsUpdate));
    backgroundTaskManager.syncWatchMode();

    try {
        await manifestManager.updateNoteManifest(noteId, (manifest) => {
            const currentNoteSettings = manifest.settings || {};
            const newNoteSettings = { ...currentNoteSettings, ...settingsUpdate };

            for (const key of Object.keys(newNoteSettings) as Array<keyof typeof newNoteSettings>) {
                if (newNoteSettings[key] === DEFAULT_SETTINGS[key]) {
                    delete newNoteSettings[key];
                }
            }

            if (Object.keys(newNoteSettings).length > 0) {
                manifest.settings = newNoteSettings;
            } else {
                delete manifest.settings;
            }
        });

        const stateAfterUpdate = getState();
        if (isPluginUnloading(container) || stateAfterUpdate.noteId !== noteId) {
            return;
        }

    } catch (error) {
        console.error(`VC: Failed to update per-note settings for note ${noteId}. Reverting.`, error);
        uiService.showNotice("Failed to save note-specific settings. Reverting.", 5000);
        
        const stateOnFailure = getState();
        if (stateOnFailure.noteId === noteId) {
            dispatch(actions.updateSettings(originalSettings));
            backgroundTaskManager.syncWatchMode();
        }
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

    const oldPath = state.settings.databasePath;
    const newPath = normalizePath(newPathRaw.trim());

    if (!newPath) {
        uiService.showNotice("Database path cannot be empty.");
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

        const oldManifest = state.settings.centralManifest;
        const newManifest = produce(oldManifest, draft => {
            for (const noteId in draft.notes) {
                const noteEntry = draft.notes[noteId];
                if (noteEntry) {
                    noteEntry.manifestPath = normalizePath(noteEntry.manifestPath.replace(oldPath, newPath));
                }
            }
        });

        // FIX: Update the plugin's settings object directly. This is the source of truth for saving.
        plugin.settings.databasePath = newPath;
        plugin.settings.centralManifest = newManifest;
        
        // Now save the updated settings from the plugin instance.
        await plugin.saveSettings();

        // Also update the Redux state for the UI to react immediately.
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
        dispatch(actions.setRenaming(false));
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
    const menuOptions = formats.map(format => ({
        title: `Export all versions as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
        callback: () => dispatch(exportAllVersions(noteId, format))
    }));

    uiService.showActionMenu(menuOptions);
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

        const selectedFolder = await uiService.promptForFolder();
        if (!selectedFolder) {
            uiService.showNotice("Export cancelled.", 2000);
            return;
        }

        const latestState = getState();
        if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
            uiService.showNotice("VC: Export cancelled because the note context changed during folder selection.");
            return;
        }

        const sanitizedNoteName = customSanitizeFileName(currentNoteName);
        const exportFileName = `Version History - ${sanitizedNoteName}.${format}`;
        const exportFilePath = await exportManager.writeFile(selectedFolder, exportFileName, exportContent);
        
        uiService.showNotice(`Successfully exported to ${exportFilePath}`, 7000);

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
    const menuOptions = formats.map(format => ({
        title: `Export version as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
        callback: () => dispatch(exportSingleVersion(version, format))
    }));

    uiService.showActionMenu(menuOptions);
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

        const selectedFolder = await uiService.promptForFolder();
        if (!selectedFolder) {
            uiService.showNotice("Export cancelled.", 2000);
            return;
        }
        
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