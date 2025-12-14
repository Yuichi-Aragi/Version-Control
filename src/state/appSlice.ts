import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { AppStatus, getInitialState } from './state';
import type { AppState, PanelState, SortOrder } from './state';
import type { VersionControlSettings, HistorySettings, VersionHistoryEntry, AppError, DiffTarget, ActiveNoteInfo, DiffType, Change, TimelineEvent, TimelineSettings, ViewMode } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';

const initialState: AppState = getInitialState(DEFAULT_SETTINGS);

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
        },

        // --- State Machine Transition Actions ---
        resetToInitializing(state) {
            state.status = AppStatus.INITIALIZING;
            state.history = [];
            state.editHistory = [];
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
            
            // Detect context change: Different file path OR Different Note ID
            // This ensures we catch cases where the file object reference changes but path is same,
            // or where we switch to a different note entirely.
            const isContextChange = state.file?.path !== file?.path || (state.noteId && state.noteId !== noteId);

            if (isContextChange) {
                 state.viewMode = 'versions'; // Reset view mode to default on context switch
                 
                 // STRICT: Close context-dependent panels on context change.
                 // Only global panels like 'changelog' should persist across note switches.
                 if (state.panel?.type !== 'changelog') {
                     state.panel = null;
                 }
                 
                 // Reset context-specific UI state
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
                state.history = [];
                state.editHistory = [];
                state.currentBranch = null;
                state.availableBranches = [];
                if (state.panel?.type !== 'changelog') {
                    state.panel = null;
                }
            } else {
                // Avoid unnecessary loading states if the view is already correct and context hasn't changed
                if (state.status === AppStatus.READY && !isContextChange && !state.isProcessing) {
                    if (state.noteId === noteId && action.payload.source !== 'manifest') {
                        return; // No change needed
                    }
                }

                state.status = AppStatus.LOADING;
                state.file = file;
                // Reset data fields
                state.noteId = null;
                state.history = [];
                state.editHistory = [];
                state.currentBranch = null;
                state.availableBranches = [];
                
                // Note: We intentionally cleared panel above if context changed. 
                // If context didn't change (e.g. reload or save), panel persists.
            }
        },
        historyLoadedSuccess(state, action: PayloadAction<{ file: TFile; noteId: string | null; history: VersionHistoryEntry[], currentBranch: string, availableBranches: string[] }>) {
            if (state.file?.path === action.payload.file.path) {
                // If we are just refreshing the same note (e.g. post-save), we DO preserve the timeline/panels.
                // The strict clearing in initializeView handles the context switch case.
                
                state.status = AppStatus.READY;
                state.noteId = action.payload.noteId;
                state.history = action.payload.history;
                state.currentBranch = action.payload.currentBranch;
                state.availableBranches = action.payload.availableBranches;
                state.isProcessing = false;
                
                state.namingVersionId = null;
                state.isManualVersionEdit = false;
                state.highlightedVersionId = null;
                state.diffRequest = null;
            }
        },
        editHistoryLoadedSuccess(state, action: PayloadAction<{ editHistory: VersionHistoryEntry[], currentBranch?: string | null, availableBranches?: string[] }>) {
             if (state.status === AppStatus.LOADING || state.status === AppStatus.READY) {
                 state.editHistory = action.payload.editHistory;
                 
                 if (action.payload.currentBranch !== undefined) {
                     state.currentBranch = action.payload.currentBranch;
                 }
                 if (action.payload.availableBranches !== undefined) {
                     state.availableBranches = action.payload.availableBranches;
                 }
                 
                 state.status = AppStatus.READY;
                 state.isProcessing = false;
             }
        },
        clearHistoryForBranchSwitch(state, action: PayloadAction<{ currentBranch: string, availableBranches: string[] }>) {
            state.status = AppStatus.LOADING;
            state.history = [];
            state.editHistory = [];
            state.currentBranch = action.payload.currentBranch;
            state.availableBranches = action.payload.availableBranches;
            state.isProcessing = false;
        },
        setViewMode(state, action: PayloadAction<ViewMode>) {
            state.viewMode = action.payload;
            
            // STRICT CLEANUP: Prevent bleed over of state from previous mode
            state.panel = null; 
            state.namingVersionId = null;
            state.isManualVersionEdit = false;
            state.highlightedVersionId = null;
            state.diffRequest = null;
            state.isSearchActive = false;
            state.searchQuery = '';
        },
        clearActiveNote(state) {
            state.status = AppStatus.PLACEHOLDER;
            state.file = null;
            state.noteId = null;
            state.history = [];
            state.editHistory = [];
            state.currentBranch = null;
            state.availableBranches = [];
            if (state.panel?.type !== 'changelog') {
                state.panel = null;
            }
            state.error = null;
            state.isManualVersionEdit = false;
            state.viewMode = 'versions';
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
                state.history.unshift(action.payload.newVersion);
                state.isProcessing = false;
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newVersion.id : null;
                state.isManualVersionEdit = false;
            }
        },
        addEditSuccess(state, action: PayloadAction<{ newEdit: VersionHistoryEntry }>) {
            if (state.status === AppStatus.READY) {
                state.editHistory.unshift(action.payload.newEdit);
                state.isProcessing = false;
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newEdit.id : null;
                state.isManualVersionEdit = false;
            }
        },
        removeEditsSuccess(state, action: PayloadAction<{ ids: string[] }>) {
            if (state.status === AppStatus.READY) {
                const idsToRemove = new Set(action.payload.ids);
                state.editHistory = state.editHistory.filter(edit => !idsToRemove.has(edit.id));
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
                const updateList = (list: VersionHistoryEntry[]) => {
                    const versionIndex = list.findIndex(v => v.id === action.payload.versionId);
                    if (versionIndex > -1) {
                        const originalVersion = list[versionIndex];
                        if (!originalVersion) return;

                        const updatedVersion = { ...originalVersion };
                        if (action.payload.name !== undefined) {
                            const newName = action.payload.name;
                            if (newName) updatedVersion.name = newName;
                            else delete updatedVersion.name;
                        }
                        if (action.payload.description !== undefined) {
                            const newDescription = action.payload.description;
                            if (newDescription) updatedVersion.description = newDescription;
                            else delete updatedVersion.description;
                        }
                        list[versionIndex] = updatedVersion;
                    }
                };

                updateList(state.history);
                updateList(state.editHistory);
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
        setTimelineSettings(state, action: PayloadAction<TimelineSettings>) {
            if (state.panel?.type === 'timeline') {
                state.panel.settings = action.payload;
            }
        },
        updateTimelineEventInState(state, action: PayloadAction<{ versionId: string; name?: string; description?: string }>) {
            if (state.panel?.type === 'timeline' && state.panel.events) {
                state.panel.events.forEach(event => {
                    if (event.toVersionId === action.payload.versionId) {
                        if (action.payload.name !== undefined) event.toVersionName = action.payload.name;
                        if (action.payload.description !== undefined) event.toVersionDescription = action.payload.description;
                    }
                });
            }
        },

        // --- Watch Mode UI action ---
        setWatchModeCountdown(state, action: PayloadAction<number | null>) {
            if (state.status === AppStatus.READY) {
                state.watchModeCountdown = action.payload;
            }
        },
    },
});

export const { actions } = appSlice;
export default appSlice.reducer;
