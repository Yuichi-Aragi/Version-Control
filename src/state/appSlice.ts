import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction, AnyAction } from '@reduxjs/toolkit';
import { AppStatus, getInitialState } from './state';
import type { AppState, PanelState, SortOrder, DiffPanel } from './state';
import type { VersionControlSettings, HistorySettings, AppError, TimelineEvent, TimelineSettings, ViewMode, ActiveNoteInfo, DiffRequest } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';

// Import Async Thunks for ExtraReducers
import { loadEffectiveSettingsForNote } from './thunks/core.thunks';
import { saveNewVersion } from './thunks/version/thunks/save-version.thunk';
import { saveNewEdit } from './thunks/edit-history/thunks/save-edit.thunk';

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
            // CRITICAL FIX: Transition to READY when settings are loaded if we have a valid context.
            // This replaces the logic previously handled by loadEffectiveSettingsForNote.fulfilled
            if (state.noteId && state.status === AppStatus.LOADING) {
                state.status = AppStatus.READY;
            }
        },
        reportError(state, action: PayloadAction<AppError>) {
            state.status = AppStatus.ERROR;
            state.error = action.payload;
            state.isProcessing = false;
        },

        // --- State Machine Transition Actions ---
        resetToInitializing(state) {
            state.status = AppStatus.INITIALIZING;
            state.contextVersion += 1;
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
            state.lastNoteId = null;
            state.lastFilePath = null;
        },
        initializeView(state, action: PayloadAction<ActiveNoteInfo>) {
            const { file, noteId } = action.payload;
            
            // Determine if context changed.
            let isContextChange = true;
            
            if (noteId) {
                // We have a definite ID. Compare with last known ID.
                const compareId = state.noteId || state.lastNoteId;
                isContextChange = compareId !== noteId;
            } else if (file) {
                // No ID (Unregistered or Initializing).
                // Check if file matches last known file path.
                if (state.lastFilePath && state.lastFilePath === file.path) {
                    // Same file path, treat as same context (waiting for ID or unregistered).
                    isContextChange = false;
                } else {
                    // Different file path.
                    // If we had a previous note ID, definitely a change.
                    if (state.lastNoteId) {
                        isContextChange = true;
                    } else {
                        // Previous was also unregistered. Compare paths directly.
                        isContextChange = state.file?.path !== file.path;
                    }
                }
            }

            if (isContextChange) {
                 // STRICT: Reset view mode to versions on context change
                 state.viewMode = 'versions';
                 state.contextVersion += 1;
                 
                 // STRICT: Reset effective settings to global defaults immediately.
                 state.effectiveSettings = { ...DEFAULT_SETTINGS.versionHistorySettings, isGlobal: true };

                 if (state.panel?.type !== 'changelog') {
                     state.panel = null;
                 }

                 // CRITICAL FIX: Reset processing state on context change.
                 // This prevents UI deadlocks if a background operation from the previous context
                 // aborts silently or fails to dispatch a completion action.
                 // Exception: Global renaming locks the entire database, so it persists.
                 if (!state.isRenaming) {
                     state.isProcessing = false;
                 }

                 state.currentBranch = null;
                 state.availableBranches = [];
                 state.diffRequest = null;
                 state.highlightedVersionId = null;
                 state.namingVersionId = null;
                 state.isManualVersionEdit = false;
                 state.isSearchActive = false;
                 state.searchQuery = '';
                 state.watchModeCountdown = null;
                 
                 state.lastNoteId = null;
                 state.lastFilePath = null;
            }
            
            if (noteId) {
                state.lastNoteId = noteId;
            }
            if (file) {
                state.lastFilePath = file.path;
            }
            
            if (!file) {
                state.status = AppStatus.PLACEHOLDER;
                state.file = null;
                state.noteId = null;
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

                state.file = file;
                state.noteId = noteId; 
                
                state.currentBranch = null;
                state.availableBranches = [];

                // If noteId is null, it means the note is unregistered.
                // We set status to READY so the UI can render the "Empty State" / "Start Tracking" view.
                // If noteId exists, we set LOADING to fetch history.
                if (!noteId) {
                    state.status = AppStatus.READY;
                } else {
                    state.status = AppStatus.LOADING;
                }
            }
        },
        
        setViewMode(state, action: PayloadAction<ViewMode>) {
            const newMode = action.payload;
            state.viewMode = newMode;
            
            state.contextVersion += 1;
            
            const defaults = newMode === 'versions' 
                ? DEFAULT_SETTINGS.versionHistorySettings 
                : DEFAULT_SETTINGS.editHistorySettings;
            state.effectiveSettings = { ...defaults, isGlobal: true };

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
            state.contextVersion += 1;
            state.file = null;
            state.noteId = null;
            state.currentBranch = null;
            state.availableBranches = [];
            if (state.panel?.type !== 'changelog') {
                state.panel = null;
            }
            // Ensure processing state is cleared when clearing note, unless global rename is active
            if (!state.isRenaming) {
                state.isProcessing = false;
            }
            state.error = null;
            state.isManualVersionEdit = false;
            
            // NOTE: We do NOT reset viewMode, effectiveSettings, lastNoteId, or lastFilePath here.
            // This preserves the user's context if they temporarily close/reopen the view (e.g. mobile sidebar).
            // The next initializeView will handle resetting if the context genuinely changes.
        },

        // --- Actions specific to ReadyState ---
        setProcessing(state, action: PayloadAction<boolean>) {
            state.isProcessing = action.payload;
        },
        setStatus(state, action: PayloadAction<AppStatus>) {
            state.status = action.payload;
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
            state.noteId = action.payload.noteId;
            state.lastNoteId = action.payload.noteId;
            if (state.status !== AppStatus.READY) {
                state.status = AppStatus.READY;
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
        setDiffRequest(state, action: PayloadAction<DiffRequest>) {
            if (state.status === AppStatus.READY) {
                state.diffRequest = action.payload;
            }
        },
        clearDiffRequest(state) {
            if (state.status === AppStatus.READY) {
                state.diffRequest = null;
            }
        },
        updateDiffPanelParams(state, action: PayloadAction<Partial<Pick<DiffPanel, 'diffType' | 'version1' | 'version2'>>>) {
            if (state.panel?.type === 'diff') {
                if (action.payload.diffType) state.panel.diffType = action.payload.diffType;
                if (action.payload.version1) state.panel.version1 = action.payload.version1;
                if (action.payload.version2) state.panel.version2 = action.payload.version2;
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
                const event = state.panel.events.find(e => e.toVersionId === versionId);
                if (event) {
                    if (name !== undefined) event.toVersionName = name;
                    if (description !== undefined) event.toVersionDescription = description;
                }
            }
        },

        // --- Watch Mode UI action ---
        setWatchModeCountdown(state, action: PayloadAction<number | null>) {
            if (state.status === AppStatus.READY || state.status === AppStatus.LOADING) {
                state.watchModeCountdown = action.payload;
            }
        },
        
        setCurrentBranch(state, action: PayloadAction<string>) {
            state.currentBranch = action.payload;
        },
        setAvailableBranches(state, action: PayloadAction<string[]>) {
            state.availableBranches = action.payload;
        }
    },
    extraReducers: (builder) => {
        // --- Core Thunks ---
        builder.addCase(loadEffectiveSettingsForNote.fulfilled, (state, action) => {
            state.effectiveSettings = action.payload;
            if (state.noteId) {
                state.status = AppStatus.READY;
            }
        });

        // --- Version Thunks ---
        builder.addCase(saveNewVersion.fulfilled, (state, action) => {
            state.isProcessing = false;
            if (action.payload && action.payload.newVersionEntry) {
                if (action.payload.newNoteId && state.noteId !== action.payload.newNoteId) {
                    state.noteId = action.payload.newNoteId;
                    state.lastNoteId = action.payload.newNoteId;
                    state.status = AppStatus.READY;
                }
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? action.payload.newVersionEntry.id : null;
                state.isManualVersionEdit = false;
            }
        });

        // --- Edit History Thunks ---
        builder.addCase(saveNewEdit.fulfilled, (state, action) => {
            state.isProcessing = false;
            if (action.payload) {
                const { newEditEntry } = action.payload;
                const shouldPromptEdit = state.effectiveSettings.enableVersionNaming || state.effectiveSettings.enableVersionDescription;
                state.namingVersionId = shouldPromptEdit ? newEditEntry.id : null;
                state.isManualVersionEdit = false;
            }
        });

        // --- Consolidated Matchers for Pending/Rejected ---
        // Exclude RTK Query actions (historyApi, changelogApi) from global processing state
        // to prevent UI freezing or global error states for data fetching issues.
        builder.addMatcher(
            (action): action is AnyAction => 
                action.type.endsWith('/pending') && 
                !action.type.startsWith('historyApi/') && 
                !action.type.startsWith('changelogApi/'),
            (state) => {
                state.isProcessing = true;
                state.error = null;
            }
        );

        builder.addMatcher(
            (action): action is AnyAction => 
                action.type.endsWith('/rejected') && 
                !action.type.startsWith('historyApi/') && 
                !action.type.startsWith('changelogApi/'),
            (state, action: any) => {
                if (action.payload === 'Context changed' || action.payload === 'Aborted') {
                    return;
                }
                
                // Check for AbortError in action.error if payload is undefined
                // This handles RTK's built-in abort mechanism
                if (action.error?.name === 'AbortError' || action.error?.message === 'Aborted') {
                    return;
                }
                
                state.isProcessing = false;
                
                const errorMessage = typeof action.payload === 'string' 
                    ? action.payload 
                    : (action.error?.message || "An unexpected error occurred");

                state.error = {
                    title: "Operation Failed",
                    message: errorMessage,
                };
                state.status = AppStatus.ERROR;
            }
        );
        
        builder.addMatcher(
            (action): action is AnyAction => 
                action.type.endsWith('/fulfilled') && 
                !action.type.startsWith('historyApi/') && 
                !action.type.startsWith('changelogApi/'),
            (state) => {
                state.isProcessing = false;
            }
        );
    }
});

export const { actions } = appSlice;
export default appSlice.reducer;
