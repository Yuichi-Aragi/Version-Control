import { App, TFolder, TFile } from 'obsidian';
import type { Container } from 'inversify';
import type { AppThunk, AppStore } from '../store';
import { actions } from '../appSlice';
import type { VersionHistoryEntry, ViewMode } from '../../types';
import { AppStatus, type ActionItem, type SortOrder, type SortProperty, type SortDirection } from '../state';
import { CHANGELOG_URL } from '../../constants';
import { loadEffectiveSettingsForNote, loadHistoryForNoteId, initializeView } from './core.thunks';
import { UIService } from '../../services/ui-service';
import { VersionManager } from '../../core/version-manager';
import { EditHistoryManager } from '../../core/edit-history-manager';
import { TYPES } from '../../types/inversify.types';
import { isPluginUnloading } from '../utils/settingsUtils';
import { versionActions } from '../../ui/VersionActions';
import { editActions } from '../../ui/EditActions';
import type VersionControlPlugin from '../../main';
import { requestWithRetry } from '../../utils/network';
import { loadEditHistory } from './edit-history.thunks';
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

export const toggleViewMode = (): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    const state = getState();

    const currentMode = state.viewMode;
    const newMode: ViewMode = currentMode === 'versions' ? 'edits' : 'versions';
    
    // 1. Pre-emptively reset effective settings to global defaults for the new mode
    // This minimizes "bleed over" of specific settings from the previous mode during the async load
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const globalDefaults = newMode === 'versions' 
        ? plugin.settings.versionHistorySettings 
        : plugin.settings.editHistorySettings;
    
    dispatch(actions.updateEffectiveSettings({ ...globalDefaults, isGlobal: true }));

    // 2. Update State (This clears panel, diffRequest, etc.)
    dispatch(actions.setViewMode(newMode));

    // 3. Load Data for New Mode
    const { noteId, file } = state;
    if (noteId && file) {
        dispatch(loadEffectiveSettingsForNote(noteId));
        
        if (newMode === 'edits') {
            dispatch(loadEditHistory(noteId));
        } else {
            dispatch(loadHistoryForNoteId(file, noteId));
        }
    }
};

export const showChangelogPanel = (options: { forceRefresh?: boolean; isManualRequest?: boolean } = {}): AppThunk => async (dispatch, getState, container) => {
    if (isPluginUnloading(container)) return;
    
    const { forceRefresh = false, isManualRequest = true } = options;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
    const uiService = container.get<UIService>(TYPES.UIService);
    const currentState = getState();

    // --- Gatekeeper for Automatic Requests ---
    // For an automatic request, if the view state isn't stable or another panel is open,
    // we queue the request and wait for a better opportunity. This is the primary
    // entry point into the queuing system.
    if (!isManualRequest) {
        const isViewStable = currentState.status === AppStatus.INITIALIZING || currentState.status === AppStatus.READY || currentState.status === AppStatus.PLACEHOLDER || currentState.status === AppStatus.LOADING;
        const isPanelAvailable = !currentState.panel || currentState.panel.type === 'changelog';
        if (!isViewStable || !isPanelAvailable) {
            plugin.queuedChangelogRequest = { forceRefresh, isManualRequest: false };
            return; // Queue and exit
        }
    }

    // --- Proceed for Manual or Ready Automatic Requests ---
    
    // We are now processing the request, so clear the queue to prevent re-processing.
    plugin.queuedChangelogRequest = null;

    // For manual requests, forcefully close any existing panel to ensure the changelog is visible.
    if (isManualRequest && currentState.panel) {
        dispatch(actions.closePanel());
    }
    
    if (isFetchingChangelog) {
        if (isManualRequest) {
            uiService.showNotice("Already fetching changelog...", 2000);
        }
        return;
    }

    if (!forceRefresh && changelogCache) {
        dispatch(actions.openPanel({ type: 'changelog', content: changelogCache }));
        // If showing from cache, it's a successful display, so update version.
        await updateVersionInSettings(container);
        return;
    }

    if (!navigator.onLine) {
        if (isManualRequest) {
            uiService.showNotice("No internet connection available.", 4000);
        }
        // For automatic requests, we fail silently and don't queue if offline.
        return;
    }

    isFetchingChangelog = true;
    dispatch(actions.openPanel({ type: 'changelog', content: null })); // Show loading state
    if (isManualRequest) {
        uiService.showNotice("Fetching latest changelog...", 2000);
    }

    try {
        const response = await requestWithRetry(CHANGELOG_URL);
        changelogCache = response.text;
        
        const stateAfterFetch = getState();
        // This is the final check before displaying the content and updating the version.
        // For a manual request, we always show it.
        // For a automatic request, we only show it if our loading panel is still the active one.
        // This prevents showing the changelog if the user has navigated away or opened another panel
        // during the fetch, which would be intrusive.
        const canShowPanelNow = isManualRequest || stateAfterFetch.panel?.type === 'changelog';

        if (canShowPanelNow) {
            dispatch(actions.openPanel({ type: 'changelog', content: changelogCache }));
            // The version is updated ONLY after we have successfully committed to showing the panel.
            // This is the key to preventing the "version updated but panel not shown" bug.
            await updateVersionInSettings(container);
        } else {
            // Another panel opened during the fetch of an automatic request.
            // We must re-queue the request to try again later.
            // Crucially, we DO NOT update the version in this case.
            plugin.queuedChangelogRequest = { forceRefresh, isManualRequest: false };
        }

    } catch (error) {
        console.error("Version Control: Failed to fetch changelog.", error);
        
        let errorMessage = "Could not fetch changelog. Check console for details.";
        if (!navigator.onLine) {
            errorMessage = "Could not fetch changelog: No internet connection.";
        } else if (error instanceof Error && (error.message.includes('status') || error.message.includes('Failed to fetch') || error.message.includes('No internet connection'))) {
            errorMessage = "Could not fetch changelog: The server could not be reached.";
        }

        if (isManualRequest) {
            uiService.showNotice(errorMessage, 5000);
        }
        
        // If the loading panel is still open, close it on failure.
        if (getState().panel?.type === 'changelog') {
            dispatch(actions.closePanel());
        }
    } finally {
        if (!isPluginUnloading(container)) {
            isFetchingChangelog = false;
        }
    }
};

export const processQueuedChangelogRequest = (): AppThunk => (dispatch, _getState, container) => {
    if (isPluginUnloading(container)) return;
    const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);

    const request = plugin.queuedChangelogRequest;
    if (request) {
        // Clear the queue BEFORE dispatching to prevent potential infinite loops.
        // The thunk itself will re-queue if necessary.
        plugin.queuedChangelogRequest = null; 
        dispatch(showChangelogPanel(request));
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
        const editHistoryManager = container.get<EditHistoryManager>(TYPES.EditHistoryManager);
        
        dispatch(actions.closePanel()); // Close the folder selection panel immediately.

        const latestState = getState();
        if (latestState.status !== AppStatus.READY || latestState.noteId !== version.noteId) {
            uiService.showNotice("VC: Deviation cancelled because the note context changed during folder selection.");
            return;
        }
        
        try {
            let newFile: TFile | null = null;
            const viewMode = latestState.viewMode;

            if (viewMode === 'versions') {
                newFile = await versionManager.createDeviation(version.noteId, version.id, selectedFolder);
            } else {
                const content = await editHistoryManager.getEditContent(version.noteId, version.id);
                if (!content) throw new Error("Could not load edit content.");
                const suffix = `(from Edit #${version.versionNumber})`;
                newFile = await versionManager.createDeviationFromContent(version.noteId, content, selectedFolder, suffix);
            }

            if (newFile) {
                uiService.showNotice(`Created new note "${newFile.basename}"...`, 5000);
                await app.workspace.getLeaf(true).openFile(newFile);
            }
        } catch (error) {
            console.error("Version Control: Error creating deviation.", error);
            uiService.showNotice("VC: Failed to create a new note from this version/edit. Check the console for details.");
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

    const isEdits = state.viewMode === 'edits';
    const actionsList = isEdits ? editActions : versionActions;
    const titlePrefix = isEdits ? 'Edit #' : 'V';

    const items: ActionItem<string>[] = actionsList.map(action => ({
        id: action.id,
        data: action.id,
        text: action.title,
        subtext: action.tooltip,
        icon: action.icon,
    }));

    const onChooseAction = (actionId: string): AppThunk => (_dispatch, _getState, _container) => {
        const action = actionsList.find(a => a.id === actionId);
        if (action) {
            // We need to get the store from the container again inside this new thunk's scope
            const store = container.get<AppStore>(TYPES.Store);
            action.actionHandler(version, store);
        }
    };

    dispatch(actions.openPanel({
        type: 'action',
        title: `Actions for ${titlePrefix}${version.versionNumber}`,
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
