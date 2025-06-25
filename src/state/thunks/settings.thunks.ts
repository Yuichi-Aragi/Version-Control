import { Thunk } from '../store';
import { actions } from '../actions';
import { VersionControlSettings, VersionHistoryEntry, VersionData } from '../../types';
import { AppStatus } from '../state';
import { customSanitizeFileName } from '../../utils/file';
import { SERVICE_NAMES } from '../../constants';
import VersionControlPlugin from '../../main';
import { UIService } from '../../services/ui-service';
import { ManifestManager } from '../../core/manifest-manager';
import { ExportManager } from '../../services/export-manager';
import { VersionManager } from '../../core/version-manager';

/**
 * Thunks for updating settings and handling export functionality.
 */

export const updateSettings = (settingsUpdate: Partial<VersionControlSettings>): Thunk => async (dispatch, getState, container) => {
    const plugin = container.resolve<VersionControlPlugin>(SERVICE_NAMES.PLUGIN);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);

    dispatch(actions.updateSettings(settingsUpdate));
    const fullNewSettings = getState().settings;
    try {
        await plugin.saveData(fullNewSettings); 
        plugin.managePeriodicOrphanCleanup();
        plugin.manageWatchModeInterval();
    } catch (error) {
        console.error("Version Control: CRITICAL: Could not save settings to disk.", error);
        uiService.showNotice("VC: Error: Could not save settings. Check console.");
    }
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
    if (initialState.status !== AppStatus.READY && initialState.noteId !== noteId) {
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
