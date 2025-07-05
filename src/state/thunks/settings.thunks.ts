import { Thunk } from '../store';
import { actions } from '../actions';
import { VersionControlSettings, VersionHistoryEntry, VersionData } from '../../types';
import { AppStatus } from '../state';
import { customSanitizeFileName } from '../../utils/file';
import { SERVICE_NAMES } from '../../constants';
import { UIService } from '../../services/ui-service';
import { ManifestManager } from '../../core/manifest-manager';
import { ExportManager } from '../../services/export-manager';
import { VersionManager } from '../../core/version-manager';
import { BackgroundTaskManager } from '../../core/BackgroundTaskManager';

/**
 * Thunks for updating settings and handling export functionality.
 */

export const updateSettings = (settingsUpdate: Partial<VersionControlSettings>): Thunk => async (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const globalSettingsManager = container.resolve<{ get: () => VersionControlSettings, save: (s: VersionControlSettings) => Promise<void> }>(SERVICE_NAMES.GLOBAL_SETTINGS_MANAGER);
    const backgroundTaskManager = container.resolve<BackgroundTaskManager>(SERVICE_NAMES.BACKGROUND_TASK_MANAGER);
    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);

    const currentGlobalSettings = globalSettingsManager.get();
    let newGlobalSettings = { ...currentGlobalSettings };
    let perNoteUpdate = { ...settingsUpdate };
    let needsGlobalSave = false;

    // --- Step 1: Handle Always-Global Settings ---
    // The orphan cleanup setting is ALWAYS global.
    if ('autoCleanupOrphanedVersions' in settingsUpdate) {
        newGlobalSettings.autoCleanupOrphanedVersions = settingsUpdate.autoCleanupOrphanedVersions!;
        delete perNoteUpdate.autoCleanupOrphanedVersions; // Remove from per-note consideration
        needsGlobalSave = true;
    }

    // The global toggle itself is ALWAYS global.
    if ('applySettingsGlobally' in settingsUpdate) {
        newGlobalSettings.applySettingsGlobally = settingsUpdate.applySettingsGlobally!;
        delete perNoteUpdate.applySettingsGlobally; // Remove from per-note consideration
        needsGlobalSave = true;
    }

    // --- Step 2: Determine where to save the rest of the settings ---
    if (newGlobalSettings.applySettingsGlobally) {
        // If global mode is on, all other changes also apply globally.
        if (Object.keys(perNoteUpdate).length > 0) {
            newGlobalSettings = { ...newGlobalSettings, ...perNoteUpdate };
            needsGlobalSave = true;
        }
    } else {
        // Global mode is OFF. Save other changes to the current note's manifest.
        const state = getState();
        if (state.status === AppStatus.READY && state.noteId) {
            if (Object.keys(perNoteUpdate).length > 0) {
                await manifestManager.updateNoteManifest(state.noteId, (manifest) => {
                    manifest.settings = { ...(manifest.settings || {}), ...perNoteUpdate };
                    return manifest;
                });
            }
        } else if (Object.keys(perNoteUpdate).length > 0) {
            // Tried to change a per-note setting without an active note.
            uiService.showNotice("Cannot save setting: No note is active.", 3000);
            return; // Abort without saving or updating state
        }
    }

    // --- Step 3: Save global settings if anything changed ---
    if (needsGlobalSave) {
        await globalSettingsManager.save(newGlobalSettings);
    }

    // --- Step 4: Update the effective settings in the Redux state ---
    // Recalculate the final effective settings for the UI to display.
    const state = getState();
    let finalEffectiveSettings = { ...newGlobalSettings }; // Start with the new global state
    if (!newGlobalSettings.applySettingsGlobally && state.status === AppStatus.READY && state.noteId) {
        // If global is off and we have a note, merge its settings
        const noteManifest = await manifestManager.loadNoteManifest(state.noteId);
        if (noteManifest?.settings) {
            finalEffectiveSettings = { ...finalEffectiveSettings, ...noteManifest.settings };
        }
    }
    
    dispatch(actions.updateSettings(finalEffectiveSettings));

    // --- Step 5: Trigger side-effects ---
    backgroundTaskManager.managePeriodicOrphanCleanup();
    backgroundTaskManager.manageWatchModeInterval();
};

export const requestExportAllVersions = (): Thunk => (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
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

export const exportAllVersions = (noteId: string, format: 'md' | 'json' | 'ndjson' | 'txt'): Thunk => async (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const exportManager = container.resolve<ExportManager>(SERVICE_NAMES.EXPORT_MANAGER);

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
        if (latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
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

export const requestExportSingleVersion = (version: VersionHistoryEntry): Thunk => (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
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

export const exportSingleVersion = (versionEntry: VersionHistoryEntry, format: 'md' | 'json' | 'ndjson' | 'txt'): Thunk => async (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const manifestManager = container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const exportManager = container.resolve<ExportManager>(SERVICE_NAMES.EXPORT_MANAGER);

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
        const versionData: VersionData = { ...versionEntry, content, notePath: versionEntry.notePath };
        
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
        if (latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
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
