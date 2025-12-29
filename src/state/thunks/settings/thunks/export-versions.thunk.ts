import { TFolder } from 'obsidian';
import type { AppThunk, Services } from '@/state';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry, VersionData } from '@/types';
import { shouldAbort } from '@/state/utils/guards';
import { customSanitizeFileName } from '@/utils/file';
import type { ExportFormat, ExportFormatActionItem, FolderActionItem } from '@/state/thunks/settings/types';
import { EXPORT_FORMATS, EXPORT_FORMAT_ICONS } from '@/state/thunks/settings/types';

/**
 * Thunks for exporting version history data.
 */

/**
 * Opens a panel to request export format for all versions.
 *
 * @returns Thunk
 */
export const requestExportAllVersions = (): AppThunk => (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    const uiService = services.uiService;
    if (state.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }

    if (state.status !== AppStatus.READY || !state.noteId) {
        uiService.showNotice("VC: Cannot export because the note is not ready or is not under version control.", 3000);
        return;
    }
    const noteId = state.noteId;

    // Filter out gzip for "Export All" as it's typically for single files
    const availableFormats = EXPORT_FORMATS.filter(f => f !== 'gzip');

    const items: ExportFormatActionItem[] = availableFormats.map(format => ({
        id: format,
        data: format,
        text: `Export all versions as ${format.toUpperCase()}`,
        icon: EXPORT_FORMAT_ICONS[format],
    }));

    const onChooseAction = (format: ExportFormat): AppThunk => (dispatch) => {
        dispatch(exportAllVersions(noteId, format));
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Choose export format',
        items,
        onChooseAction,
        showFilter: false,
    }));
};

/**
 * Exports all versions for a note in the specified format.
 *
 * @param noteId - The note ID to export versions from
 * @param format - The export format
 * @returns Async thunk
 */
export const exportAllVersions = (noteId: string, format: ExportFormat): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const initialState = getState().app;
    const uiService = services.uiService;
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }
    const manifestManager = services.manifestManager;
    const exportManager = services.exportManager;
    const app = services.app;

    if (initialState.status !== AppStatus.READY || initialState.noteId !== noteId) {
        uiService.showNotice("VC: Export cancelled because the view context changed.", 3000);
        return;
    }
    dispatch(appSlice.actions.setProcessing(true));
    try {
        const noteManifest = await manifestManager.loadNoteManifest(noteId);
        if (!noteManifest) {
            throw new Error(`Export failed: Could not find manifest for note ID ${noteId}.`);
        }
        const currentNoteName = noteManifest.notePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        const viewMode = initialState.viewMode;
        const type = viewMode === 'versions' ? 'version' : 'edit';

        uiService.showNotice(`Preparing to export all ${type}s for "${currentNoteName}"...`, 3000);

        const versionsData = await exportManager.getAllVersionsData(noteId, type);
        
        // Race Check: Verify context after async data fetch
        if (shouldAbort(services, getState, { noteId })) {
            uiService.showNotice("VC: Export cancelled because the note context changed.");
            return;
        }

        if (versionsData.length === 0) {
            uiService.showNotice(`No ${type}s found for "${currentNoteName}" to export.`, 3000);
            return;
        }

        const exportContent = await exportManager.generateExport(versionsData, format);
        
        const folders = app.vault.getAllFolders();
        const folderItems: FolderActionItem[] = folders.map(folder => ({
            id: folder.path,
            data: folder,
            text: folder.isRoot() ? "/" : folder.path,
        }));

        const onChooseFolder = (selectedFolder: TFolder): AppThunk => async (dispatch, _getState) => {
            dispatch(appSlice.actions.closePanel()); // Close the folder selection panel immediately.

            if (shouldAbort(services, getState, { noteId: initialState.noteId, status: AppStatus.READY })) {
                uiService.showNotice("VC: Export cancelled because the note context changed during folder selection.");
                return;
            }
            const sanitizedNoteName = customSanitizeFileName(currentNoteName);
            const exportFileName = `History - ${sanitizedNoteName}.${format}`;
            const exportFilePath = await exportManager.writeFile(selectedFolder, exportFileName, exportContent);
            uiService.showNotice(`Successfully exported to ${exportFilePath}`, 7000);
        };

        dispatch(appSlice.actions.openPanel({
            type: 'action',
            title: 'Export to folder...',
            items: folderItems,
            onChooseAction: onChooseFolder,
            showFilter: true,
        }));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Version Control: Export failed for all versions of note ID ${noteId.substring(0, 8)}...`, error);
        uiService.showNotice(`Error: Failed to export all versions. ${errorMessage}.`, 7000);
    } finally {
        if (!shouldAbort(services, getState)) {
            const finalState = getState().app;
            if (finalState.status === AppStatus.READY) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    }
};

/**
 * Opens a panel to request export format for a single version.
 *
 * @param version - The version to export
 * @returns Thunk
 */
export const requestExportSingleVersion = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    const uiService = services.uiService;
    if (state.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot export version because the view context is not ready or has changed.", 3000);
        return;
    }

    const items: ExportFormatActionItem[] = EXPORT_FORMATS.map(format => ({
        id: format,
        data: format,
        text: `Export version as ${format.toUpperCase()}`,
        icon: EXPORT_FORMAT_ICONS[format],
    }));

    const onChooseAction = (format: ExportFormat): AppThunk => (dispatch) => {
        dispatch(exportSingleVersion(version, format));
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: `Export V${version.versionNumber}`,
        items,
        onChooseAction,
        showFilter: false,
    }));
};

/**
 * Exports a single version in the specified format.
 *
 * @param versionEntry - The version to export
 * @param format - The export format
 * @returns Async thunk
 */
export const exportSingleVersion = (versionEntry: VersionHistoryEntry, format: ExportFormat): AppThunk => async (dispatch, getState, services: Services) => {
    if (shouldAbort(services, getState)) return;
    const initialState = getState().app;
    const uiService = services.uiService;
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot export while database is being renamed.");
        return;
    }
    const manifestManager = services.manifestManager;
    const versionManager = services.versionManager;
    const editHistoryManager = services.editHistoryManager;
    const exportManager = services.exportManager;
    const app = services.app;

    if (initialState.status !== AppStatus.READY || initialState.noteId !== versionEntry.noteId) {
        uiService.showNotice("VC: Export cancelled because the view context changed.", 3000);
        return;
    }
    dispatch(appSlice.actions.setProcessing(true));
    try {
        const noteManifest = await manifestManager.loadNoteManifest(versionEntry.noteId);
        if (!noteManifest) {
            throw new Error(`Manifest for note ID ${versionEntry.noteId} not found.`);
        }
        const currentNoteName = noteManifest.notePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        const viewMode = getState().app.viewMode;

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

        // Race Check: Verify context after content load
        if (shouldAbort(services, getState, { noteId: versionEntry.noteId })) {
            return;
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

        const exportContent = await exportManager.generateExport([versionData], format);

        const folders = app.vault.getAllFolders();
        const folderItems: FolderActionItem[] = folders.map(folder => ({
            id: folder.path,
            data: folder,
            text: folder.isRoot() ? "/" : folder.path,
        }));

        const onChooseFolder = (selectedFolder: TFolder): AppThunk => async (dispatch, _getState) => {
            dispatch(appSlice.actions.closePanel()); // Close the folder selection panel immediately.

            if (shouldAbort(services, getState, { noteId: initialState.noteId, status: AppStatus.READY })) {
                uiService.showNotice("VC: Export cancelled because the note context changed during folder selection.");
                return;
            }

            const sanitizedNoteName = customSanitizeFileName(currentNoteName);
            const typeLabel = viewMode === 'versions' ? 'Version' : 'Edit';
            const idLabel = viewMode === 'versions' ? `V${versionData.versionNumber}` : `Edit ${versionData.versionNumber}`;
            const versionIdSuffix = versionData.name ? customSanitizeFileName(versionData.name) : customSanitizeFileName(idLabel);
            
            // Adjust extension for gzip if needed
            const finalFormat = format === 'gzip' ? 'md.gz' : format;
            
            const exportFileName = `${typeLabel} - ${sanitizedNoteName} - ${versionIdSuffix}.${finalFormat}`;
            const exportFilePath = await exportManager.writeFile(selectedFolder, exportFileName, exportContent);

            uiService.showNotice(`Successfully exported to ${exportFilePath}`, 7000);
        };

        dispatch(appSlice.actions.openPanel({
            type: 'action',
            title: 'Export to folder...',
            items: folderItems,
            onChooseAction: onChooseFolder,
            showFilter: true,
        }));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Version Control: Export failed for version V${versionEntry.versionNumber} of note ID ${versionEntry.noteId.substring(0, 8)}...`, error);
        uiService.showNotice(`Error: Failed to export version. ${errorMessage}.`, 7000);
    } finally {
        if (!shouldAbort(services, getState)) {
            const finalState = getState().app;
            if (finalState.status === AppStatus.READY) {
                dispatch(appSlice.actions.setProcessing(false));
            }
        }
    }
};