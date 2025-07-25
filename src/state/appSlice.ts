import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import type { Change } from 'diff';
import { find } from 'lodash-es';
import { AppStatus, getInitialState } from './state';
import type { AppState, PanelState, SortOrder } from './state';
import type { VersionControlSettings, VersionHistoryEntry, AppError, DiffTarget, ActiveNoteInfo } from '../types';
import { DEFAULT_SETTINGS } from '../constants';

const initialState: AppState = getInitialState(DEFAULT_SETTINGS);

export const appSlice = createSlice({
    name: 'app',
    initialState,
    reducers: {
        // --- Global Actions ---
        updateSettings(state, action: PayloadAction<Partial<VersionControlSettings>>) {
            state.settings = { ...state.settings, ...action.payload };
        },
        reportError(state, action: PayloadAction<AppError>) {
            state.status = AppStatus.ERROR;
            state.error = action.payload;
        },

        // --- State Machine Transition Actions ---
        initializeView(state, action: PayloadAction<ActiveNoteInfo>) {
            const { file } = action.payload;
            if (!file) {
                state.status = AppStatus.PLACEHOLDER;
                state.file = null;
                state.noteId = null;
                state.history = [];
            } else {
                // Avoid unnecessary loading states if the view is already correct
                if (state.status === AppStatus.READY && state.file?.path === file.path && !state.isProcessing) {
                    if (state.noteId === action.payload.noteId && action.payload.source !== 'manifest') {
                        return; // No change needed
                    }
                }
                state.status = AppStatus.LOADING;
                state.file = file;
                // Reset other fields
                state.noteId = null;
                state.history = [];
                state.panel = null;
            }
        },
        historyLoadedSuccess(state, action: PayloadAction<{ file: TFile; noteId: string | null; history: VersionHistoryEntry[] }>) {
            if (state.file?.path === action.payload.file.path) {
                state.status = AppStatus.READY;
                state.noteId = action.payload.noteId;
                state.history = action.payload.history;
                state.isProcessing = false;
                state.panel = null;
                state.namingVersionId = null;
                state.highlightedVersionId = null;
                state.diffRequest = null;
            }
        },
        clearActiveNote(state) {
            state.status = AppStatus.PLACEHOLDER;
            state.file = null;
            state.noteId = null;
            state.history = [];
            state.panel = null;
            state.error = null;
        },

        // --- Actions specific to ReadyState ---
        setProcessing(state, action: PayloadAction<boolean>) {
            state.isProcessing = action.payload;
        },
        openPanel(state, action: PayloadAction<NonNullable<PanelState>>) {
            if (state.status === AppStatus.READY) {
                state.panel = action.payload;
                state.isProcessing = false;
                state.namingVersionId = null;
                state.isSearchActive = false;
                state.searchQuery = '';
            }
        },
        closePanel(state) {
            if (state.status === AppStatus.READY) {
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
                state.namingVersionId = state.settings.enableVersionNaming ? action.payload.newVersion.id : null;
            }
        },
        startVersionEditing(state, action: PayloadAction<{ versionId: string }>) {
            if (state.status === AppStatus.READY) {
                state.namingVersionId = action.payload.versionId;
            }
        },
        stopVersionEditing(state) {
            if (state.status === AppStatus.READY) {
                state.namingVersionId = null;
            }
        },
        updateVersionDetailsInState(state, action: PayloadAction<{ versionId: string; name?: string }>) {
            if (state.status === AppStatus.READY) {
                const version = find(state.history, { id: action.payload.versionId });
                if (version) {
                    const newName = action.payload.name;
                    // This logic mirrors the one in `version-manager` for consistency:
                    // a non-empty name is set, while an empty or undefined name is removed.
                    if (newName) {
                        version.name = newName;
                    } else {
                        delete version.name;
                    }
                }
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
        startDiffGeneration(state, action: PayloadAction<{ version1: VersionHistoryEntry; version2: DiffTarget }>) {
            if (state.status === AppStatus.READY) {
                state.diffRequest = {
                    status: 'generating',
                    version1: action.payload.version1,
                    version2: action.payload.version2,
                    diffChanges: null,
                };
                state.panel = null; // Close any open panel when starting a diff
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
