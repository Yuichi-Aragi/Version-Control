import { TFolder, TFile } from 'obsidian';
import type { AppThunk, Services } from '@/state';
import { appSlice } from '@/state';
import type { VersionHistoryEntry, ViewMode } from '@/types';
import { AppStatus, type ActionItem, type SortOrder, type SortProperty, type SortDirection } from '@/state';
import { loadEffectiveSettingsForNote, loadHistoryForNoteId } from './core.thunks';
import { shouldAbort } from '@/state/utils/guards';
import { versionActions } from '@/ui/VersionActions';
import { editActions } from '@/ui/EditActions';
import { loadEditHistory } from '@/state/thunks/edit-history';
import { createBranch, switchBranch, requestDeleteBranch } from '@/state/thunks/version';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

const updateVersionInSettings = async (services: Services): Promise<void> => {
    try {
        const plugin = services.plugin;
        const currentPluginVersion = plugin.manifest.version;
        if (plugin.settings.version !== currentPluginVersion) {
            plugin.settings.version = currentPluginVersion;
            await plugin.saveSettings();
        }
    } catch (error) {
        console.error("Version Control: Failed to save updated version to settings.", error);
    }
};

export const toggleViewMode = (): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    // Defensive check for settings availability
    if (!services.plugin?.settings) {
        console.warn("Version Control: Plugin settings not available in toggleViewMode");
        return;
    }
    
    const state = getState().app;
    const currentMode = state.viewMode;
    const newMode: ViewMode = currentMode === 'versions' ? 'edits' : 'versions';
    
    // 1. Pre-emptively reset effective settings to global defaults for the new mode
    const plugin = services.plugin;
    const globalDefaults = newMode === 'versions' 
        ? plugin.settings.versionHistorySettings 
        : plugin.settings.editHistorySettings;
    
    dispatch(appSlice.actions.updateEffectiveSettings({ ...globalDefaults, isGlobal: true }));

    // 2. Update State (This clears panel, diffRequest, etc. and sets status to LOADING)
    // This also increments contextVersion, invalidating previous loads.
    dispatch(appSlice.actions.setViewMode(newMode));
    
    // Capture the new context version
    const contextVersion = getState().app.contextVersion;

    // 3. Load Data for New Mode
    const { noteId, file } = state;

    // Handle Unregistered Note Case
    if (file && !noteId) {
        dispatch(appSlice.actions.historyLoadedSuccess({
            file: file,
            noteId: null,
            history: [],
            currentBranch: null,
            availableBranches: [],
            contextVersion
        }));
        return;
    }

    // Handle Registered Note Case
    if (noteId && file) {
        // STRICT SYNCHRONIZATION:
        // We must await settings resolution BEFORE loading history.
        await dispatch(loadEffectiveSettingsForNote(noteId));
        
        // Race Check: Ensure context matches after settings load
        if (shouldAbort(services, getState, { contextVersion })) return;

        if (newMode === 'edits') {
            await dispatch(loadEditHistory(noteId));
        } else {
            await dispatch(loadHistoryForNoteId({ file, noteId }));
        }

        // CRITICAL: Sync watch mode AFTER history is loaded.
        if (!shouldAbort(services, getState, { contextVersion })) {
            services.backgroundTaskManager.syncWatchMode();
        }
    }
};

export const showChangelogPanel = (options: { forceRefresh?: boolean; isManualRequest?: boolean } = {}): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    const { isManualRequest = true } = options;
    const plugin = services.plugin;
    const currentState = getState().app;

    if (!isManualRequest) {
        const isViewStable = currentState.status === AppStatus.INITIALIZING || currentState.status === AppStatus.READY || currentState.status === AppStatus.PLACEHOLDER || currentState.status === AppStatus.LOADING;
        const isPanelAvailable = !currentState.panel || currentState.panel.type === 'changelog';
        if (!isViewStable || !isPanelAvailable) {
            plugin.queuedChangelogRequest = { forceRefresh: options.forceRefresh ?? false, isManualRequest: false };
            return;
        }
    }

    plugin.queuedChangelogRequest = null;

    if (isManualRequest && currentState.panel) {
        dispatch(appSlice.actions.closePanel());
    }

    dispatch(appSlice.actions.openPanel({ type: 'changelog' }));
    
    await updateVersionInSettings(services);
};

export const processQueuedChangelogRequest = (): AppThunk => (dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const plugin = services.plugin;

    const request = plugin.queuedChangelogRequest;
    if (request) {
        plugin.queuedChangelogRequest = null; 
        dispatch(showChangelogPanel(request));
    }
};

export const createDeviation = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const uiService = services.uiService;
    const app = services.app;
    const initialState = getState().app;
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot create deviation while database is being renamed.");
        return;
    }
    if (initialState.status !== AppStatus.READY || !initialState.noteId || initialState.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot create a deviation from this version/edit because the note context changed.");
        return;
    }
    
    const folders = app.vault.getAllFolders();
    const items: ActionItem<TFolder>[] = folders.map(folder => ({
        id: folder.path,
        data: folder,
        text: folder.isRoot() ? "/" : folder.path,
    }));

    const onChooseAction = (selectedFolder: TFolder): AppThunk => async (dispatch, getState, services) => {
        if (shouldAbort(services, getState)) return;
        const versionManager = services.versionManager;
        const editHistoryManager = services.editHistoryManager;
        
        dispatch(appSlice.actions.closePanel());

        // Race Check: Ensure context matches after panel close and before async ops
        if (shouldAbort(services, getState, { noteId: version.noteId, status: AppStatus.READY })) {
            uiService.showNotice("VC: Deviation cancelled because the note context changed during folder selection.");
            return;
        }
        
        try {
            let newFile: TFile | null = null;
            const viewMode = getState().app.viewMode;

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

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Create new note in...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

export const showVersionContextMenu = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;

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

    const onChooseAction = (actionId: string): AppThunk => (_dispatch, _getState, services) => {
        const action = actionsList.find(a => a.id === actionId);
        if (action) {
            const store = services.store;
            action.actionHandler(version, store);
        }
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: `Actions for ${titlePrefix}${version.versionNumber}`,
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const showSortMenu = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;

    if (state.status !== AppStatus.READY) return;
    
    const sortOptions: { label: string; property: SortProperty; direction: SortDirection }[] = [
        { label: 'Version (new to old)', property: 'versionNumber', direction: 'desc' },
        { label: 'Version (old to new)', property: 'versionNumber', direction: 'asc' },
        { label: 'Timestamp (new to old)', property: 'timestamp', direction: 'desc' },
        { label: 'Timestamp (old to new)', property: 'timestamp', direction: 'asc' },
        { label: 'Name (A to Z)', property: 'name', direction: 'asc' },
        { label: 'Name (Z to A)', property: 'name', direction: 'desc' },
        { label: 'Size (largest to smallest)', property: 'size', direction: 'desc' },
        { label: 'Size (smallest to largest)', property: 'size', direction: 'asc' },
    ];

    const items: ActionItem<SortOrder>[] = sortOptions.map(opt => {
        const isSelected = state.sortOrder.property === opt.property && state.sortOrder.direction === opt.direction;
        return {
            id: `${opt.property}-${opt.direction}`,
            data: { property: opt.property, direction: opt.direction },
            text: opt.label,
            icon: 'blank',
            isSelected,
        };
    });

    const onChooseAction = (sortOrder: SortOrder): AppThunk => (dispatch) => {
        dispatch(appSlice.actions.setSortOrder(sortOrder));
        dispatch(appSlice.actions.closePanel());
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Sort by',
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const showBranchSwitcher = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
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

    const contextActions = (item: ActionItem<string>): ActionItem<string>[] => {
        if (item.id === '__create__') return [];
        return [
            { id: 'delete', data: 'delete', text: 'Delete Branch', icon: 'trash' }
        ];
    };

    const onContextAction = (actionId: string, branchName: string): AppThunk => (dispatch) => {
        if (actionId === 'delete') {
            dispatch(requestDeleteBranch(branchName));
        }
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Switch or create branch',
        items,
        onChooseAction,
        onCreateAction,
        contextActions,
        onContextAction,
        showFilter: true,
    }));
};

export const showNotice = (message: string, duration?: number): AppThunk => (_dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const uiService = services.uiService;
    uiService.showNotice(message, duration);
};

export const closeSettingsPanelWithNotice = (message: string, duration?: number): AppThunk => (dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const uiService = services.uiService;
    dispatch(appSlice.actions.closePanel());
    uiService.showNotice(message, duration);
};

export const openDashboard = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    if (state.status !== AppStatus.READY) return;

    dispatch(appSlice.actions.openPanel({ type: 'dashboard' }));
};
