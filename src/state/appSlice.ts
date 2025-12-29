import { createSlice, createEntityAdapter, createSelector } from '@reduxjs/toolkit';
import type { PayloadAction, AnyAction } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { orderBy } from 'es-toolkit';
import { AppStatus, getInitialState } from './state';
import type { AppState, PanelState, SortOrder, RootState } from './state';
import type { VersionControlSettings, HistorySettings, VersionHistoryEntry, AppError, DiffTarget, DiffType, Change, TimelineEvent, TimelineSettings, ViewMode, ActiveNoteInfo } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';

// Import Async Thunks for ExtraReducers
import { loadHistory, loadHistoryForNoteId, loadEffectiveSettingsForNote } from './thunks/core.thunks';
import { saveNewVersion } from './thunks/version/thunks/save-version.thunk';
// CRITICAL FIX: Direct import to ensure consistency with ui.thunks.ts
import { loadEditHistory } from './thunks/edit-history/thunks/load-edit-history.thunk';
import { saveNewEdit } from './thunks/edit-history/thunks/save-edit.thunk';

// ============================================================================
// ENTITY ADAPTERS
// ============================================================================

export const historyAdapter = createEntityAdapter<VersionHistoryEntry, string>({
    selectId: (entry) => entry.id,
    sortComparer: (a, b) => b.versionNumber - a.versionNumber,
});

export const editHistoryAdapter = createEntityAdapter<VersionHistoryEntry, string>({
    selectId: (entry) => entry.id,
    sortComparer: (a, b) => b.versionNumber - a.versionNumber,
});

const initialState: AppState = getInitialState(DEFAULT_SETTINGS);

// ============================================================================
// SLICE DEFINITION
// ============================================================================

export const appSlice = createSlice({
    name: 'app',
    initialState,
    reducers: {
        // --- Global Actions ---
        updateSettings(state, action: PayloadAction<Partial<VersionControlSettings>>) {
            state.settings = { ...state.settings, ...action.payload };
        },
        updateEffectiveSettings(state, action: PayloadAction<HistorySettings>) {
            state.effectiveSettings = action.payload;
        },
        reportError(state, action: PayloadAction<AppError>) {
            state.status = AppStatus.ERROR;
            state.error = action.payload;
            state.isProcessing = false;
        },

        // --- State Machine Transition Actions ---
        resetToInitializing(state) {
            state.status = AppStatus.INITIALIZING;
            state.contextVersion += 1; // Invalidate pending operations
            historyAdapter.removeAll(state.history);
            editHistoryAdapter.removeAll(state.editHistory);
            state.currentBranch = null;
            state.availableBranches = [];
            state.panel = null;
            state.diffRequest = null;
            state.error = null;
            state.isProcessing = false;
            state.isRenaming = false;
            state.namingVersionId = null;
            state.isManualVersionEdit = false;
            state.highlightedVersionId = null;
            state.watchModeCountdown = null;
        },
        initializeView(state, action: PayloadAction<ActiveNoteInfo>) {
            const { file, noteId } = action.payload;
            
            const isContextChange = state.file?.path !== file?.path || (state.noteId && state.noteId !== noteId);

            if (isContextChange) {
                 // STRICT: Reset view mode to versions on context change
                 state.viewMode = 'versions';
                 state.contextVersion += 1; // Invalidate pending operations
                 
                 // STRICT: Reset effective settings to global defaults immediately.
                 state.effectiveSettings = { ...DEFAULT_SETTINGS.versionHistorySettings, isGlobal: true };

                 if (state.panel?.type !== 'changelog') {
                     state.panel = null;
                 }
                 historyAdapter.removeAll(state.history);
                 editHistoryAdapter.removeAll(state.editHistory);
                 state.currentBranch = null;
                 state.availableBranches = [];
                 state.diffRequest = null;
                 state.highlightedVersionId = null;
                 state.namingVersionId = null;
                 state.isManualVersionEdit = false;
                 state.isSearchActive = false;
                 state.searchQuery = '';
                 state.watchModeCountdown = null;
            }
            
            if (!file) {
                state.status = AppStatus.PLACEHOLDER;
                state.file = null;
                state.noteId = null;
                historyAdapter.removeAll(state.history);
                editHistoryAdapter.removeAll(state.editHistory);
                state.currentBranch = null;
                state.availableBranches = [];
                if (state.panel?.type !== 'changelog') {
                    state.panel = null;
                }
            } else {
                if (state.status === AppStatus.READY && !isContextChange && !state.isProcessing) {
                    if (state.noteId === noteId && action.payload.source !== 'manifest') {
                        return;
                    }
                }

                state.status = AppStatus.LOADING;
                state.file = file;
                state.noteId = noteId; 
                
                historyAdapter.removeAll(state.history);
                editHistoryAdapter.removeAll(state.editHistory);
                state.currentBranch = null;
                state.availableBranches = [];
            }
        },
        historyLoadedSuccess(
            state, 
            action: PayloadAction<{ 
                file: TFile; 
                noteId: string | null; 
                history: VersionHistoryEntry[], 
                currentBranch: string | null, 
                availableBranches: string[],
                contextVersion: number 
            }>
        ) {
            // CRITICAL GUARD: Only apply if context version matches
            if (action.payload.contextVersion !== state.contextVersion) return;

            if (state.file?.path === action.payload.file.path) {
                state.status = AppStatus.READY;
                state.noteId = action.payload.noteId;
                historyAdapter.setAll(state.history, action.payload.history);
                state.currentBranch = action.payload.currentBranch;
                state.availableBranches = action.payload.availableBranches;
                state.isProcessing = false;
                
                state.namingVersionId = null;
                state.isManualVersionEdit = false;
                state.highlightedVersionId = null;
                state.diffRequest = null;
            }
        },
        editHistoryLoadedSuccess(
            state, 
            action: PayloadAction<{ 
                editHistory: VersionHistoryEntry[], 
                currentBranch?: string | null, 
                availableBranches?: string[],
                contextVersion: number
            }>
        ) {
             // CRITICAL GUARD: Only apply if context version matches
             if (action.payload.contextVersion !== state.contextVersion) return;

             if (state.status === AppStatus.LOADING || (state.status === AppStatus.READY && state.viewMode === 'edits')) {
                 editHistoryAdapter.setAll(state.editHistory, action.payload.editHistory);
                 if (action.payload.currentBranch !== undefined) state.currentBranch = action.payload.currentBranch;
                 if (action.payload.availableBranches !== undefined) state.availableBranches = action.payload.availableBranches;
                 state.status = AppStatus.READY;
                 state.isProcessing = false;
             }
        },
        clearHistoryForBranchSwitch(state, action: PayloadAction<{ currentBranch: string, availableBranches: string[] }>) {
            state.status = AppStatus.LOADING;
            state.contextVersion += 1; // Invalidate pending operations
            historyAdapter.removeAll(state.history);
            editHistoryAdapter.removeAll(state.editHistory);
            state.currentBranch = action.payload.currentBranch;
            state.availableBranches = action.payload.availableBranches;
            state.isProcessing = false;
        },
        setViewMode(state, action: PayloadAction<ViewMode>) {
            const newMode = action.payload;
            state.viewMode = newMode;
            state.status = AppStatus.LOADING;
            state.contextVersion += 1; // Invalidate pending operations
            
            // STRICT: Reset effective settings to defaults for the new mode immediately.
            const defaults = newMode === 'versions' 
                ? DEFAULT_SETTINGS.versionHistorySettings 
                : DEFAULT_SETTINGS.editHistorySettings;
            state.effectiveSettings = { ...defaults, isGlobal: true };

            historyAdapter.removeAll(state.history);
            editHistoryAdapter.removeAll(state.editHistory);
            state.panel = null; 
            state.namingVersionId = null;
            state.isManualVersionEdit = false;
            state.highlightedVersionId = null;
            state.diffRequest = null;
            state.isSearchActive = false;
            state.searchQuery = '';
            state.watchModeCountdown = null;
        },
        clearActiveNote(state) {
            state.status = AppStatus.PLACEHOLDER;
            state.contextVersion += 1; // Invalidate pending operations
            state.file = null;
            state.noteId = null;
            historyAdapter.removeAll(state.history);
            editHistoryAdapter.removeAll(state.editHistory);
            state.currentBranch = null;
            state.availableBranches = [];
            if (state.panel?.type !== 'changelog') {
                state.panel = null;
            }
            state.error = null;
            state.isManualVersionEdit = false;
            state.viewMode = 'versions';
            
            // Reset settings to default versions
            state.effectiveSettings = { ...DEFAULT_SETTINGS.versionHistorySettings, isGlobal: true };
        },

        // --- Actions specific to ReadyState ---
        setProcessing(state, action: PayloadAction<boolean>) {
            state.isProcessing = action.payload;
        },
        setRenaming(state, action: PayloadAction<boolean>) {
            state.isRenaming = action.payload;
        },
        openPanel(state, action: PayloadAction<NonNullable<PanelState>>) {
            const panelToOpen = action.payload;

            if (panelToOpen.type === 'changelog') {
                if (state.status === AppStatus.INITIALIZING || state.status === AppStatus.READY || state.status === AppStatus.PLACEHOLDER || state.status === AppStatus.LOADING) {
                    state.panel = panelToOpen;
                }
                return;
            }

            const isOverlayCandidate = panelToOpen.type === 'action' || panelToOpen.type === 'confirmation';

            if (state.panel?.type === 'description' && isOverlayCandidate) {
                state.panel = {
                    type: 'stacked',
                    base: state.panel,
                    overlay: panelToOpen,
                };
                return;
            }
            
            if (state.panel?.type === 'stacked' && isOverlayCandidate) {
                state.panel.overlay = panelToOpen;
                return;
            }

            if (state.status === AppStatus.READY) {
                state.panel = panelToOpen;
                state.isProcessing = false;
                state.namingVersionId = null;
                state.isSearchActive = false;
                state.searchQuery = '';
            }
        },
        closePanel(state) {
            if (state.panel?.type === 'stacked') {
                state.panel = state.panel.base;
                return;
            }

            if (state.status === AppStatus.INITIALIZING || state.status === AppStatus.READY || state.status === AppStatus.PLACEHOLDER || state.status === AppStatus.LOADING) {
                state.panel = null;
            }
        },
        updateNoteIdInState(state, action: PayloadAction<{ noteId: string }>) {
            if (state.status === AppStatus.READY) {
                state.noteId = action.payload.noteId;
            }
        },
        addVersionSuccess(state, action: PayloadAction<{ newVersion: VersionHistoryEntry }>) {
            if (state.status === AppStatus.READY) {
                historyAdapter.addOne(state.history, action.payload.newVersion);
                state.isProcessing = false;
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newVersion.id : null;
                state.isManualVersionEdit = false;
            }
        },
        addEditSuccess(state, action: PayloadAction<{ newEdit: VersionHistoryEntry }>) {
            if (state.status === AppStatus.READY) {
                editHistoryAdapter.addOne(state.editHistory, action.payload.newEdit);
                state.isProcessing = false;
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newEdit.id : null;
                state.isManualVersionEdit = false;
            }
        },
        removeEditsSuccess(state, action: PayloadAction<{ ids: string[] }>) {
            if (state.status === AppStatus.READY) {
                editHistoryAdapter.removeMany(state.editHistory, action.payload.ids);
            }
        },
        startVersionEditing(state, action: PayloadAction<{ versionId: string }>) {
            if (state.status === AppStatus.READY) {
                state.namingVersionId = action.payload.versionId;
                state.isManualVersionEdit = true;
            }
        },
        stopVersionEditing(state) {
            if (state.status === AppStatus.READY) {
                state.namingVersionId = null;
                state.isManualVersionEdit = false;
            }
        },
        updateVersionDetailsInState(state, action: PayloadAction<{ versionId: string; name?: string; description?: string }>) {
            if (state.status === AppStatus.READY) {
                const { versionId, name, description } = action.payload;
                const changes: Partial<VersionHistoryEntry> = {};
                if (name !== undefined) changes.name = name || undefined;
                if (description !== undefined) changes.description = description || undefined;

                historyAdapter.updateOne(state.history, { id: versionId, changes });
                editHistoryAdapter.updateOne(state.editHistory, { id: versionId, changes });
            }
        },

        // --- Search/sort/filter actions ---
        toggleSearch(state, action: PayloadAction<boolean>) {
            if (state.status === AppStatus.READY) {
                state.isSearchActive = action.payload;
                if (action.payload) {
                    state.panel = null;
                    state.isSearchCaseSensitive = false;
                } else {
                    state.searchQuery = '';
                    state.isSearchCaseSensitive = false;
                }
            }
        },
        setSearchQuery(state, action: PayloadAction<string>) {
            if (state.status === AppStatus.READY) {
                state.searchQuery = action.payload;
            }
        },
        setSearchCaseSensitivity(state, action: PayloadAction<boolean>) {
            if (state.status === AppStatus.READY) {
                state.isSearchCaseSensitive = action.payload;
            }
        },
        setSortOrder(state, action: PayloadAction<SortOrder>) {
            if (state.status === AppStatus.READY) {
                state.sortOrder = action.payload;
            }
        },

        // --- Diff actions ---
        setHighlightedVersion(state, action: PayloadAction<{ versionId: string | null }>) {
            if (state.status === AppStatus.READY) {
                state.highlightedVersionId = action.payload.versionId;
            }
        },
        startDiffGeneration(state, action: PayloadAction<{ version1: VersionHistoryEntry; version2: DiffTarget; content1: string; content2: string }>) {
            if (state.status === AppStatus.READY) {
                state.diffRequest = {
                    status: 'generating',
                    version1: action.payload.version1,
                    version2: action.payload.version2,
                    content1: action.payload.content1,
                    content2: action.payload.content2,
                    diffType: 'lines',
                    diffChanges: null,
                };
                state.panel = null;
            }
        },
        diffGenerationSucceeded(state, action: PayloadAction<{ version1Id: string; version2Id: string; diffChanges: Change[] }>) {
            if (state.status === AppStatus.READY && state.diffRequest && state.diffRequest.version1.id === action.payload.version1Id && state.diffRequest.version2.id === action.payload.version2Id) {
                state.diffRequest.status = 'ready';
                state.diffRequest.diffChanges = action.payload.diffChanges;
            }
        },
        diffGenerationFailed(state, action: PayloadAction<{ version1Id: string; version2Id: string }>) {
            if (state.status === AppStatus.READY && state.diffRequest && state.diffRequest.version1.id === action.payload.version1Id && state.diffRequest.version2.id === action.payload.version2Id) {
                state.diffRequest = null;
            }
        },
        clearDiffRequest(state) {
            if (state.status === AppStatus.READY) {
                state.diffRequest = null;
            }
        },
        startReDiffing(state, action: PayloadAction<{ newDiffType: DiffType }>) {
            if (state.panel?.type === 'diff') {
                state.panel.isReDiffing = true;
                state.panel.diffType = action.payload.newDiffType;
            }
        },
        reDiffingSucceeded(state, action: PayloadAction<{ diffChanges: Change[] }>) {
            if (state.panel?.type === 'diff') {
                state.panel.isReDiffing = false;
                state.panel.diffChanges = action.payload.diffChanges;
            }
        },
        reDiffingFailed(state) {
            if (state.panel?.type === 'diff') {
                state.panel.isReDiffing = false;
            }
        },

        // --- Timeline Actions ---
        setTimelineData(state, action: PayloadAction<TimelineEvent[]>) {
            if (state.panel?.type === 'timeline') {
                state.panel.events = action.payload;
            }
        },
        addTimelineEvent(state, action: PayloadAction<TimelineEvent>) {
            if (state.panel?.type === 'timeline' && state.panel.events) {
                state.panel.events.unshift(action.payload);
            }
        },
        removeTimelineEvent(state, action: PayloadAction<{ versionId: string }>) {
            if (state.panel?.type === 'timeline' && state.panel.events) {
                const idToRemove = action.payload.versionId;
                state.panel.events = state.panel.events.filter(e => e.toVersionId !== idToRemove);
            }
        },
        setTimelineSettings(state, action: PayloadAction<TimelineSettings>) {
            if (state.panel?.type === 'timeline') {
                state.panel.settings = action.payload;
            }
        },
        updateTimelineEventInState(state, action: PayloadAction<{ versionId: string; name?: string; description?: string }>) {
            if (state.panel?.type === 'timeline' && state.panel.events) {
                const { versionId, name, description } = action.payload;
                // Direct mutation is safe with Immer
                const event = state.panel.events.find(e => e.toVersionId === versionId);
                if (event) {
                    if (name !== undefined) event.toVersionName = name;
                    if (description !== undefined) event.toVersionDescription = description;
                }
            }
        },

        // --- Watch Mode UI action ---
        setWatchModeCountdown(state, action: PayloadAction<number | null>) {
            // Allow updates during LOADING to capture initial sync from thunks before READY transition
            if (state.status === AppStatus.READY || state.status === AppStatus.LOADING) {
                state.watchModeCountdown = action.payload;
            }
        },
    },
    extraReducers: (builder) => {
        // --- Core Thunks ---
        builder.addCase(loadEffectiveSettingsForNote.fulfilled, (state, action) => {
            state.effectiveSettings = action.payload;
        });

        builder.addCase(loadHistory.fulfilled, (state, action) => {
            // CRITICAL GUARD: Check context version
            if (action.payload.contextVersion !== state.contextVersion) return;

            if (state.file?.path === action.payload.file.path) {
                state.status = AppStatus.READY;
                state.noteId = action.payload.noteId;
                historyAdapter.setAll(state.history, action.payload.history);
                state.currentBranch = action.payload.currentBranch;
                state.availableBranches = action.payload.availableBranches;
                state.isProcessing = false;
                
                state.namingVersionId = null;
                state.isManualVersionEdit = false;
                state.highlightedVersionId = null;
                state.diffRequest = null;
            }
        });

        builder.addCase(loadHistoryForNoteId.fulfilled, (state, action) => {
             // CRITICAL GUARD: Check context version
             if (action.payload.contextVersion !== state.contextVersion) return;

             if (state.file?.path === action.payload.file.path) {
                state.status = AppStatus.READY;
                state.noteId = action.payload.noteId;
                historyAdapter.setAll(state.history, action.payload.history);
                state.currentBranch = action.payload.currentBranch;
                state.availableBranches = action.payload.availableBranches;
                state.isProcessing = false;
                
                state.namingVersionId = null;
                state.isManualVersionEdit = false;
                state.highlightedVersionId = null;
                state.diffRequest = null;
            }
        });

        // --- Version Thunks ---
        builder.addCase(saveNewVersion.fulfilled, (state, action) => {
            state.isProcessing = false;
            if (action.payload && action.payload.newVersionEntry) {
                historyAdapter.addOne(state.history, action.payload.newVersionEntry);
                if (action.payload.newNoteId && state.noteId !== action.payload.newNoteId) {
                    state.noteId = action.payload.newNoteId;
                }
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newVersionEntry.id : null;
                state.isManualVersionEdit = false;
            }
        });

        // --- Edit History Thunks ---
        builder.addCase(loadEditHistory.fulfilled, (state, action) => {
             // CRITICAL GUARD: Check context version
             if (action.payload.contextVersion !== state.contextVersion) return;

             if (state.status === AppStatus.LOADING || (state.status === AppStatus.READY && state.viewMode === 'edits')) {
                 editHistoryAdapter.setAll(state.editHistory, action.payload.editHistory);
                 if (action.payload.currentBranch !== null) state.currentBranch = action.payload.currentBranch;
                 if (action.payload.availableBranches.length > 0) state.availableBranches = action.payload.availableBranches;
                 state.status = AppStatus.READY;
                 state.isProcessing = false;
             }
        });

        builder.addCase(saveNewEdit.fulfilled, (state, action) => {
            state.isProcessing = false;
            if (action.payload) {
                const { newEditEntry, deletedIds } = action.payload;
                editHistoryAdapter.addOne(state.editHistory, newEditEntry);
                
                if (deletedIds.length > 0) {
                    editHistoryAdapter.removeMany(state.editHistory, deletedIds);
                }

                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? newEditEntry.id : null;
                state.isManualVersionEdit = false;
            }
        });

        // --- Consolidated Matchers for Pending/Rejected ---
        // This handles isProcessing and Error state for all thunks automatically
        builder.addMatcher(
            (action): action is AnyAction => action.type.endsWith('/pending'),
            (state) => {
                state.isProcessing = true;
                state.error = null;
            }
        );

        builder.addMatcher(
            (action): action is AnyAction => action.type.endsWith('/rejected'),
            (state, action: any) => {
                // If context changed, we ignore the error completely.
                // This prevents stale errors from clobbering the loading state of a new request.
                if (action.payload === 'Context changed' || action.payload === 'Aborted') {
                    return;
                }
                
                state.isProcessing = false;
                state.error = {
                    title: "Operation Failed",
                    message: typeof action.payload === 'string' ? action.payload : "An unexpected error occurred",
                };
                // CRITICAL FIX: Ensure status transitions to ERROR so UI doesn't get stuck in LOADING
                state.status = AppStatus.ERROR;
            }
        );
        
        // We also need a matcher for fulfilled to ensure isProcessing is reset for thunks that didn't have specific handlers above
        builder.addMatcher(
            (action): action is AnyAction => action.type.endsWith('/fulfilled'),
            (state) => {
                state.isProcessing = false;
            }
        );
    }
});

// ============================================================================
// SELECTORS
// ============================================================================

const historySelectors = historyAdapter.getSelectors((state: RootState) => state.app.history);
const editHistorySelectors = editHistoryAdapter.getSelectors((state: RootState) => state.app.editHistory);

export const {
    selectAll: selectAllHistory,
    selectById: selectHistoryById,
} = historySelectors;

export const {
    selectAll: selectAllEditHistory,
    selectById: selectEditHistoryById,
} = editHistorySelectors;

// Memoized Sorted Selectors using es-toolkit
export const selectSortedHistory = createSelector(
    [selectAllHistory, (state: RootState) => state.app.sortOrder],
    (history, sortOrder) => {
        return orderBy(history, [sortOrder.property], [sortOrder.direction]);
    }
);

export const selectSortedEditHistory = createSelector(
    [selectAllEditHistory, (state: RootState) => state.app.sortOrder],
    (history, sortOrder) => {
        return orderBy(history, [sortOrder.property], [sortOrder.direction]);
    }
);

// Helper to select the correct history based on view mode
export const selectActiveHistory = createSelector(
    [
        (state: RootState) => state.app.viewMode,
        selectSortedHistory,
        selectSortedEditHistory
    ],
    (viewMode, history, editHistory) => {
        return viewMode === 'versions' ? history : editHistory;
    }
);

export const { actions } = appSlice;
export default appSlice.reducer;
