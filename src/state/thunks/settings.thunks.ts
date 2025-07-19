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

/**
 * Thunks for updating settings and handling export functionality.
 */

export const updateSettings = (settingsUpdate: Partial<VersionControlSettings>): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

    const stateBeforeUpdate = getState();
    
    // FIX: Use a type-safe method to create a copy of the original settings.
    // The spread syntax within reduce is correctly inferred by TypeScript and avoids
    // the "is not assignable to type 'never'" error that occurs with direct indexed assignment.
    const originalSettings = (Object.keys(settingsUpdate) as Array<keyof VersionControlSettings>)
        .reduce((acc, key) => ({
            ...acc,
            [key]: stateBeforeUpdate.settings[key]
        }), {} as Partial<VersionControlSettings>);

    // --- Handle all per-note settings ---
    if (stateBeforeUpdate.status !== AppStatus.READY || !stateBeforeUpdate.noteId) {
        uiService.showNotice("A note with version history must be active to change its settings.", 5000);
        return;
    }
    const { noteId } = stateBeforeUpdate;

    // Optimistic UI update
    dispatch(actions.updateSettings(settingsUpdate));
    backgroundTaskManager.syncWatchMode();

    try {
        await manifestManager.updateNoteManifest(noteId, (manifest) => {
            // Ensure the settings object exists before merging
            const currentNoteSettings = manifest.settings || {};
            const newNoteSettings = { ...currentNoteSettings, ...settingsUpdate };

            // Prune settings that are the same as the default to keep manifests clean.
            for (const key of Object.keys(newNoteSettings) as Array<keyof typeof newNoteSettings>) {
                if (newNoteSettings[key] === DEFAULT_SETTINGS[key]) {
                    delete newNoteSettings[key];
                }
            }

            if (Object.keys(newNoteSettings).length > 0) {
                manifest.settings = newNoteSettings;
            } else {
                // If no overrides remain, remove the settings object entirely.
                delete manifest.settings;
            }
            
            return manifest;
        });

        // Re-validate state after await.
        const stateAfterUpdate = getState();
        if (isPluginUnloading(container) || stateAfterUpdate.noteId !== noteId) {
            // The setting was saved for the original note, but the view has changed.
            // The UI is already showing the settings for the new note, so we don't need to do anything.
            // The optimistic update is now irrelevant for the current view.
            return;
        }

    } catch (error) {
        console.error(`VC: Failed to update per-note settings for note ${noteId}. Reverting.`, error);
        uiService.showNotice("Failed to save note-specific settings. Reverting.", 5000);
        
        // Revert UI on failure, but only if we are still on the same note.
        const stateOnFailure = getState();
        if (stateOnFailure.noteId === noteId) {
            dispatch(actions.updateSettings(originalSettings));
            backgroundTaskManager.syncWatchMode();
        }
    }
};

export const requestExportAllVersions = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("VC: Cannot export. Note not ready or not under version control.", 3000);
        return;
    }
    const noteId = state.noteId;

    const formats: Array<'md' | 'json' | 'ndjson' | 'txt'> = ['md', 'json', 'ndjson', 'txt'];
    const menuOptions = formats.map(format => ({
        title: `Export All as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
        callback: () => dispatch(exportAllVersions(noteId, format))
    }));

    uiService.showActionMenu(menuOptions);
};

export const exportAllVersions = (noteId: string, format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const exportManager = container.get<ExportManager>(TYPES.ExportManager);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY || initialState.noteId !== noteId) {
        uiService.showNotice("VC: Export cancelled. View context changed.", 3000);
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

        // Re-validate context after await
        const latestState = getState();
        if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
            uiService.showNotice("VC: Note context changed during folder selection. Export cancelled.");
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
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot export version. View context is not ready or has changed.", 3000);
        return;
    }

    const formats: Array<'md' | 'json' | 'ndjson' | 'txt'> = ['md', 'json', 'ndjson', 'txt'];
    const menuOptions = formats.map(format => ({
        title: `Export as ${format.toUpperCase()}`,
        icon: { md: "file-text", json: "braces", ndjson: "list-ordered", txt: "file-code" }[format],
        callback: () => dispatch(exportSingleVersion(version, format))
    }));

    uiService.showActionMenu(menuOptions);
};

export const exportSingleVersion = (versionEntry: VersionHistoryEntry, format: 'md' | 'json' | 'ndjson' | 'txt'): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const exportManager = container.get<ExportManager>(TYPES.ExportManager);

    const initialState = getState();
    if (initialState.status !== AppStatus.READY || initialState.noteId !== versionEntry.noteId) {
        uiService.showNotice("VC: Export cancelled. View context changed.", 3000);
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
        
        // Re-validate context after await
        const latestState = getState();
        if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
            uiService.showNotice("VC: Note context changed during folder selection. Export cancelled.");
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
