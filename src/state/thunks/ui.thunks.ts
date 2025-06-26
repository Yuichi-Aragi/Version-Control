import { MouseEvent as ObsidianMouseEvent, App } from 'obsidian';
import { Thunk } from '../store';
import { actions } from '../actions';
import { VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { VIEW_TYPE_VERSION_PREVIEW, SERVICE_NAMES } from '../../constants';
import { initializeView } from './core.thunks';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

export const viewVersionInPanel = (version: VersionHistoryEntry): Thunk => async (dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
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
            dispatch(actions.openPreviewPanel({ version, content }));
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

export const viewVersionInNewTab = (version: VersionHistoryEntry): Thunk => async (_dispatch, getState, container) => {
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const app = container.resolve<App>(SERVICE_NAMES.APP);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) return;
    
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

export const createDeviation = (version: VersionHistoryEntry): Thunk => async (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const versionManager = container.resolve<VersionManager>(SERVICE_NAMES.VERSION_MANAGER);
    const app = container.resolve<App>(SERVICE_NAMES.APP);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) return;
    
    if (state.noteId !== version.noteId) {
        uiService.showNotice("VC: Note context changed. Cannot create deviation from this version now.");
        return;
    }
    
    try {
        const selectedFolder = await uiService.promptForFolder();
        if (!selectedFolder) {
            uiService.showNotice("Deviation cancelled.", 2000);
            return;
        }

        const latestState = getState();
        if (latestState.status !== AppStatus.READY || latestState.noteId !== version.noteId) {
            uiService.showNotice("VC: Note context changed. Deviation cancelled.");
            return;
        }
        
        const newFile = await versionManager.createDeviation(latestState.noteId, version.id, selectedFolder);
        if (newFile) {
            uiService.showNotice(`Created new note "${newFile.basename}" from version ${version.id.substring(0,6)}...`, 5000);
            await app.workspace.getLeaf(true).openFile(newFile);
        }

    } catch (error) {
        console.error("Version Control: Error creating deviation.", error);
        uiService.showNotice("VC: Failed to create new note from version. Check console.");
    }
};

export const showVersionContextMenu = (version: VersionHistoryEntry, event: ObsidianMouseEvent): Thunk => (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const state = getState();

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        return;
    }
    uiService.showVersionContextMenu(version, event);
};

export const showSortMenu = (event: MouseEvent): Thunk => (dispatch, getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    const state = getState();

    if (state.status !== AppStatus.READY) return;
    uiService.showSortMenu(state.sortOrder, event);
};

export const showNotice = (message: string, duration?: number): Thunk => (_dispatch, _getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    uiService.showNotice(message, duration);
};

export const closeSettingsPanelWithNotice = (message: string, duration?: number): Thunk => (dispatch, _getState, container) => {
    const uiService = container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
    dispatch(actions.closePanel());
    uiService.showNotice(message, duration);
};
