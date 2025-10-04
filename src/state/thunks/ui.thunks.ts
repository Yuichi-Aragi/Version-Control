import { App, TFolder } from 'obsidian';
import type { Container } from 'inversify';
import type { AppThunk, AppStore } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry } from '../../types';
import { AppStatus, type ActionItem, type SortOrder, type SortProperty, type SortDirection } from '../state';
import { VIEW_TYPE_VERSION_PREVIEW, CHANGELOG_URL } from '../../constants';
import { initializeView } from './core.thunks';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from './ThunkUtils';
import { versionActions } from '../../ui/VersionActions';
import type VersionControlPlugin from '../../main';
import { requestWithRetry } from '../../utils/network';
import { createBranch, switchBranch } from './version.thunks';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

let changelogCache: string | null = null;
let isFetchingChangelog = false; // Flag to prevent concurrent fetches

/**
 * Updates the plugin version in settings to the current manifest version.
 * This is called after a changelog is successfully displayed to prevent it
 * from showing again on the next startup.
 * @param container The Inversify container.
 */
const updateVersionInSettings = async (container: Container): Promise<void> => {
    try {
        const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
        const currentPluginVersion = plugin.manifest.version;
        if (plugin.settings.version !== currentPluginVersion) {
            plugin.settings.version = currentPluginVersion;
            await plugin.saveSettings();
        }
    } catch (error) {
        console.error("Version Control: Failed to save updated version to settings.", error);
        // This is a non-critical error, so we don't bother the user with a notice.
    }
};

export const showChangelogPanel = (options: { forceRefresh?: boolean } = {}): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    
    const { forceRefresh = false } = options;
    const uiService = container.get<UIService>(TYPES.UIService);

    // If a manual view is requested, we should always update the version upon success.
    // If we have a cache and it's not a forced refresh, just show it.
    if (!forceRefresh && changelogCache) {
        dispatch(actions.openPanel({ type: 'changelog', content: changelogCache }));
        return;
    }

    if (isFetchingChangelog) {
        // If a fetch is already in progress, don't start another one.
        // If it was a manual request, let the user know.
        if (forceRefresh) {
            uiService.showNotice("Already fetching changelog...", 2000);
        }
        return;
    }

    if (!navigator.onLine) {
        if (forceRefresh) { // Only show notice on manual attempts
            uiService.showNotice("No internet connection available.", 4000);
        }
        return;
    }

    isFetchingChangelog = true;
    dispatch(actions.openPanel({ type: 'changelog', content: null })); // Show loading state
    if (forceRefresh) {
        uiService.showNotice("Fetching latest changelog...", 2000);
    }

    try {
        const response = await requestWithRetry(CHANGELOG_URL);
        changelogCache = response.text;
        
        const currentState = getState();
        // The view is considered stable if it's in a state that can show a panel.
        const canOpenPanel = currentState.status === AppStatus.READY || currentState.status === AppStatus.PLACEHOLDER || currentState.status === AppStatus.LOADING;
        // We open it if there's no panel, or if the changelog loading panel is still visible.
        // This prevents overwriting a confirmation dialog or other important UI.
        const isPanelSafeToOverwrite = !currentState.panel || currentState.panel.type === 'changelog';
        
        if (canOpenPanel && isPanelSafeToOverwrite) {
            dispatch(actions.openPanel({ type: 'changelog', content: changelogCache }));
        }

        // On successful fetch and display, update the stored version.
        // This covers both initial load and manual refresh from a button.
        await updateVersionInSettings(container);

    } catch (error) {
        console.error("Version Control: Failed to fetch changelog.", error);
        
        let errorMessage = "Could not fetch changelog. Check console for details.";
        if (!navigator.onLine) {
            errorMessage = "Could not fetch changelog: No internet connection.";
        } else if (error instanceof Error && (error.message.includes('status') || error.message.includes('Failed to fetch') || error.message.includes('No internet connection'))) {
            errorMessage = "Could not fetch changelog: The server could not be reached.";
        }

        uiService.showNotice(errorMessage, 5000);
        
        if (getState().panel?.type === 'changelog') {
            dispatch(actions.closePanel());
        }
        // Do not update settings on failure.
    } finally {
        if (!isPluginUnloading(container)) {
            isFetchingChangelog = false;
        }
    }
};

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

export const createDeviation = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const uiService = container.get<UIService>(TYPES.UIService);
    const app = container.get<App>(TYPES.App);
    const initialState = getState();
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot create deviation while database is being renamed.");
        return;
    }
    if (initialState.status !== AppStatus.READY || !initialState.noteId || initialState.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot create a deviation from this version because the note context changed.");
        return;
    }
    
    const folders = app.vault.getAllFolders();
    const items: ActionItem<TFolder>[] = folders.map(folder => ({
        id: folder.path,
        data: folder,
        text: folder.isRoot() ? "/" : folder.path,
    }));

    const onChooseAction = (selectedFolder: TFolder): AppThunk => async (dispatch, getState, container) => {
        if (isPluginUnloading(container)) return;
        const versionManager = container.get<VersionManager>(TYPES.VersionManager);
        
        dispatch(actions.closePanel()); // Close the folder selection panel immediately.

        const latestState = getState();
        if (latestState.status !== AppStatus.READY || latestState.noteId !== version.noteId) {
            uiService.showNotice("VC: Deviation cancelled because the note context changed during folder selection.");
            return;
        }
        
        try {
            const newFile = await versionManager.createDeviation(version.noteId, version.id, selectedFolder);
            if (newFile) {
                uiService.showNotice(`Created new note "${newFile.basename}" from version ${version.id.substring(0,6)}...`, 5000);
                await app.workspace.getLeaf(true).openFile(newFile);
            }
        } catch (error) {
            console.error("Version Control: Error creating deviation.", error);
            uiService.showNotice("VC: Failed to create a new note from this version. Check the console for details.");
        }
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Create new note in...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

export const showVersionContextMenu = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        return;
    }

    const items: ActionItem<string>[] = versionActions.map(action => ({
        id: action.id,
        data: action.id,
        text: action.title,
        subtext: action.tooltip,
        icon: action.icon,
    }));

    const onChooseAction = (actionId: string): AppThunk => (_dispatch, _getState, _container) => {
        const action = versionActions.find(a => a.id === actionId);
        if (action) {
            // We need to get the store from the container again inside this new thunk's scope
            const store = container.get<AppStore>(TYPES.Store);
            action.actionHandler(version, store);
        }
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: `Actions for V${version.versionNumber}`,
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const showSortMenu = (): AppThunk => (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();

    if (state.status !== AppStatus.READY) return;
    
    const sortOptions: { label: string; property: SortProperty; direction: SortDirection }[] = [
        { label: 'Version (new to old)', property: 'versionNumber', direction: 'desc' },
        { label: 'Version (old to new)', property: 'versionNumber', direction: 'asc' },
        { label: 'Timestamp (new to old)', property: 'timestamp', direction: 'desc' },
        { label: 'Timestamp (old to new)', property: 'timestamp', direction: 'asc' },
        { label: 'Name (A to Z)', property: 'name', direction: 'asc' },
        { label: 'Name (Z to A)', property: 'name', direction: 'desc' },
        { label: 'Size (largest to smallest)', property: 'size', direction: 'desc' },
        { label: 'Size (smallest to largest)', property: 'size', 'direction': 'asc' },
    ];

    const items: ActionItem<SortOrder>[] = sortOptions.map(opt => {
        const isSelected = state.sortOrder.property === opt.property && state.sortOrder.direction === opt.direction;
        return {
            id: `${opt.property}-${opt.direction}`,
            data: { property: opt.property, direction: opt.direction },
            text: opt.label,
            icon: 'blank', // Provide a placeholder for alignment; 'check' is handled by isSelected.
            isSelected,
        };
    });

    const onChooseAction = (sortOrder: SortOrder): AppThunk => (dispatch) => {
        dispatch(actions.setSortOrder(sortOrder));
        dispatch(actions.closePanel());
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Sort by',
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const showBranchSwitcher = (): AppThunk => (dispatch, getState) => {
    const state = getState();
    if (state.status !== AppStatus.READY || !state.noteId) return;

    const { availableBranches, currentBranch } = state;

    const items: ActionItem<string>[] = availableBranches.map(branchName => ({
        id: branchName,
        data: branchName,
        text: branchName,
        isSelected: branchName === currentBranch,
    }));

    const onChooseAction = (branchName: string): AppThunk => (dispatch) => {
        dispatch(switchBranch(branchName));
    };

    const onCreateAction = (newBranchName: string): AppThunk => (dispatch) => {
        dispatch(createBranch(newBranchName));
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: 'Switch or create branch',
        items,
        onChooseAction,
        onCreateAction,
        showFilter: true,
    }));
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
