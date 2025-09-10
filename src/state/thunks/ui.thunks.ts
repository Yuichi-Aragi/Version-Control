import { App } from 'obsidian';
import type { AppThunk } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry } from '../../types';
import { AppStatus } from '../state';
import { VIEW_TYPE_VERSION_PREVIEW } from '../../constants';
import { initializeView } from './core.thunks';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

export const viewVersionInPanel = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId) return;
    
    dispatch(actions.setProcessing(true));
    try {
        if (state.noteId !== version.noteId) {
            uiService.showNotice("VC: Cannot preview this version now because the note context changed.");
            dispatch(initializeView());
            return;
        }
        const content = await versionManager.getVersionContent(state.noteId, version.id);

        const stateAfterFetch = getState();
        if (isPluginUnloading(container) || stateAfterFetch.status !== AppStatus.READY || stateAfterFetch.noteId !== state.noteId) {
            return;
        }

        if (content !== null) {
            dispatch(actions.openPanel({ type: 'preview', version, content }));
        } else {
            uiService.showNotice("VC: Error: Could not load version content for preview.");
        }
    } catch (error) {
        console.error("Version Control: Error fetching content for preview panel.", error);
        uiService.showNotice("VC: Failed to load content for preview. Check the console for details.");
    } finally {
        const finalState = getState();
        if (finalState.status === AppStatus.READY) {
             dispatch(actions.setProcessing(false));
        }
    }
};

export const viewVersionInNewTab = (version: VersionHistoryEntry): AppThunk => async (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);
    const state = getState();

    if (state.status !== AppStatus.READY || !state.noteId || !state.file) return;
    
    try {
        if (state.noteId !== version.noteId) {
            uiService.showNotice("VC: Cannot open this version in a new tab because the note context changed.");
            return;
        }
        const content = await versionManager.getVersionContent(state.noteId, version.id);

        const stateAfterFetch = getState();
        if (isPluginUnloading(container) || stateAfterFetch.status !== AppStatus.READY || stateAfterFetch.noteId !== state.noteId || !stateAfterFetch.file) {
            return;
        }

        if (content === null) {
            uiService.showNotice("VC: Error: Could not load version content for new tab.");
            return;
        }
        const { file, noteId: currentNoteId } = stateAfterFetch; 
        
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
        uiService.showNotice("VC: Failed to open version in a new tab. Check the console for details.");
    }
};

export const createDeviation = (version: VersionHistoryEntry): AppThunk => async (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const initialState = getState();
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot create deviation while database is being renamed.");
        return;
    }

    const versionManager = container.get<VersionManager>(TYPES.VersionManager);
    const app = container.get<App>(TYPES.App);
    
    if (initialState.status !== AppStatus.READY || !initialState.noteId) return;
    
    if (initialState.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot create a deviation from this version because the note context changed.");
        return;
    }
    
    try {
        const selectedFolder = await uiService.promptForFolder();
        if (!selectedFolder) {
            uiService.showNotice("Deviation cancelled.", 2000);
            return;
        }

        const latestState = getState();
        if (isPluginUnloading(container) || latestState.status !== AppStatus.READY || latestState.noteId !== initialState.noteId) {
            uiService.showNotice("VC: Deviation cancelled because the note context changed during folder selection.");
            return;
        }
        
        const newFile = await versionManager.createDeviation(initialState.noteId, version.id, selectedFolder);
        if (newFile) {
            uiService.showNotice(`Created new note "${newFile.basename}" from version ${version.id.substring(0,6)}...`, 5000);
            await app.workspace.getLeaf(true).openFile(newFile);
        }

    } catch (error) {
        console.error("Version Control: Error creating deviation.", error);
        uiService.showNotice("VC: Failed to create a new note from this version. Check the console for details.");
    }
};

export const showVersionContextMenu = (version: VersionHistoryEntry, event: MouseEvent): AppThunk => (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        return;
    }
    uiService.showVersionContextMenu(version, event);
};

export const showSortMenu = (event: MouseEvent): AppThunk => (_dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const state = getState();

    if (state.status !== AppStatus.READY) return;
    uiService.showSortMenu(state.sortOrder, event);
};

export const showNotice = (message: string, duration?: number): AppThunk => (_dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    uiService.showNotice(message, duration);
};

export const closeSettingsPanelWithNotice = (message: string, duration?: number): AppThunk => (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    dispatch(actions.closePanel());
    uiService.showNotice(message, duration);
};