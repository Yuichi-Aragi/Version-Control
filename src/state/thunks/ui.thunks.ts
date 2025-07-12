import { App } from 'obsidian';
import { AppThunk } from '../store';
import { actions } from '../appSlice';
import { VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { VIEW_TYPE_VERSION_PREVIEW } from '../../constants';
import { initializeView } from './core.thunks';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { TYPES } from '../../types/inversify.types';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

export const viewVersionInPanel = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) return;
    
    dispatch(actions.setProcessing(true));
    try {
        if (state.noteId !== version.noteId) {
            uiService.showNotice("VC: Note context changed. Cannot preview this version now.");
            dispatch(initializeView());
            return;
        }
        const content = await versionManager.getVersionContent(state.noteId, version.id);
        if (content !== null) {
            dispatch(actions.openPanel({ type: 'preview', version, content }));
        } else {
            uiService.showNotice("VC: Error: Could not load version content for preview.");
        }
    } catch (error) {
        console.error("Version Control: Error fetching content for preview panel.", error);
        uiService.showNotice("VC: Failed to load content for preview. Check console.");
    } finally {
        const finalState = getState();
        // Ensure processing is turned off only if the panel is open or if it failed to open
        if (finalState.status === AppStatus.READY) {
             dispatch(actions.setProcessing(false));
        }
    }
};

export const viewVersionInNewTab = (version: VersionHistoryEntry): AppThunk => async (_dispatch, getState, container) => {
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    
    try {
        if (state.noteId !== version.noteId) {
            uiService.showNotice("VC: Note context changed. Cannot open this version in new tab now.");
            return;
        }
        const content = await versionManager.getVersionContent(state.noteId, version.id);
        if (content === null) {
            uiService.showNotice("VC: Error: Could not load version content for new tab.");
            return;
        }
        const { file, noteId: currentNoteId } = state; 
        
        const leaf = app.workspace.getLeaf('tab'); 
        await leaf.setViewState({
            type: VIEW_TYPE_VERSION_PREVIEW,
            active: true,
            state: { 
                version,
                content,
                notePath: file.path,
                noteName: file.basename,
                noteId: currentNoteId,
            }
        });
        app.workspace.revealLeaf(leaf);
    } catch (error) {
        console.error("Version Control: Error opening version in new tab.", error);
        uiService.showNotice("VC: Failed to open version in new tab. Check console.");
    }
};

export const createDeviation = (version: VersionHistoryEntry): AppThunk => async (_dispatch, getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const app = container.get<App>(TYPES.App);
    
    const initialState = getState();

    if (initialState.status !== AppStatus.READY || !initialState.noteId) return;
    
    if (initialState.noteId !== version.noteId) {
        uiService.showNotice("VC: Note context changed. Cannot create deviation from this version now.");
        return;
    }
    
    try {
        const selectedFolder = await uiService.promptForFolder();
        if (!selectedFolder) {
            uiService.showNotice("Deviation cancelled.", 2000);
            return;
        }

        // Re-validate context after await
        const latestState = getState();
        if (latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
            uiService.showNotice("VC: Note context changed during folder selection. Deviation cancelled.");
            return;
        }
        
        // Proceed with the original noteId, which we've confirmed is still valid for the current context.
        const newFile = await versionManager.createDeviation(initialState.noteId, version.id, selectedFolder);
        if (newFile) {
            uiService.showNotice(`Created new note "${newFile.basename}" from version ${version.id.substring(0,6)}...`, 5000);
            await app.workspace.getLeaf(true).openFile(newFile);
        }

    } catch (error) {
        console.error("Version Control: Error creating deviation.", error);
        uiService.showNotice("VC: Failed to create new note from version. Check console.");
    }
};

// FIX: Renamed unused 'dispatch' parameter to '_dispatch' to resolve TS6133 error.
export const showVersionContextMenu = (version: VersionHistoryEntry, event: MouseEvent): AppThunk => (_dispatch, getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        return;
    }
    uiService.showVersionContextMenu(version, event);
};

// FIX: Renamed unused 'dispatch' parameter to '_dispatch' to resolve TS6133 error.
export const showSortMenu = (event: MouseEvent): AppThunk => (_dispatch, getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY) return;
    uiService.showSortMenu(state.sortOrder, event);
};

export const showNotice = (message: string, duration?: number): AppThunk => (_dispatch, _getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    uiService.showNotice(message, duration);
};

export const closeSettingsPanelWithNotice = (message: string, duration?: number): AppThunk => (dispatch, _getState, container) => {
    const uiService = container.get<UIService>(TYPES.UIService);
    dispatch(actions.closePanel());
    uiService.showNotice(message, duration);
};
