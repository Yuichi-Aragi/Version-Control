import { TFile } from 'obsidian';
import { Change } from 'diff';
import { VersionControlSettings, VersionHistoryEntry, ActiveNoteInfo, AppError, DiffTarget } from '../types';
import { ConfirmationPanel, PreviewPanel, DiffPanel, PanelState, SortOrder } from './state';

/**
 * @enum ActionType
 * Defines all possible action types that can be dispatched in the application.
 */
export enum ActionType {
    // --- Global Actions ---
    UPDATE_SETTINGS = 'UPDATE_SETTINGS',
    REPORT_ERROR = 'REPORT_ERROR',

    // --- State Machine Transition Actions ---
    INITIALIZE_VIEW = 'INITIALIZE_VIEW', // Primary driver for context changes
    HISTORY_LOADED_SUCCESS = 'HISTORY_LOADED_SUCCESS',
    CLEAR_ACTIVE_NOTE = 'CLEAR_ACTIVE_NOTE', // Transitions to PlaceholderState

    // --- Actions specific to ReadyState ---
    SET_PROCESSING = 'SET_PROCESSING', // Global UI lock for async operations
    OPEN_PANEL = 'OPEN_PANEL',
    CLOSE_PANEL = 'CLOSE_PANEL',
    UPDATE_NOTE_ID_IN_STATE = 'UPDATE_NOTE_ID_IN_STATE', // Updates noteId in ReadyState (e.g., after first save)

    // NEW/MODIFIED actions for inline naming/editing
    ADD_VERSION_SUCCESS = 'ADD_VERSION_SUCCESS',
    START_VERSION_EDITING = 'START_VERSION_EDITING',
    STOP_VERSION_EDITING = 'STOP_VERSION_EDITING',
    UPDATE_VERSION_DETAILS_IN_STATE = 'UPDATE_VERSION_DETAILS_IN_STATE',

    // search/sort/filter actions
    TOGGLE_SEARCH = 'TOGGLE_SEARCH',
    SET_SEARCH_QUERY = 'SET_SEARCH_QUERY',
    SET_SEARCH_CASE_SENSITIVITY = 'SET_SEARCH_CASE_SENSITIVITY',
    SET_SORT_ORDER = 'SET_SORT_ORDER',

    // Diff actions
    SET_HIGHLIGHTED_VERSION = 'SET_HIGHLIGHTED_VERSION',
    START_DIFF_GENERATION = 'START_DIFF_GENERATION',
    DIFF_GENERATION_SUCCEEDED = 'DIFF_GENERATION_SUCCEEDED',
    DIFF_GENERATION_FAILED = 'DIFF_GENERATION_FAILED',
    CLEAR_DIFF_REQUEST = 'CLEAR_DIFF_REQUEST',

    // Watch Mode UI action
    SET_WATCH_MODE_COUNTDOWN = 'SET_WATCH_MODE_COUNTDOWN',
}

// ===================================================================================
// ACTION INTERFACES
// ===================================================================================

export interface UpdateSettingsAction { type: ActionType.UPDATE_SETTINGS; payload: Partial<VersionControlSettings>; }
export interface ReportErrorAction { type: ActionType.REPORT_ERROR; payload: AppError; }

export interface InitializeViewAction { type: ActionType.INITIALIZE_VIEW; payload: ActiveNoteInfo; }
export interface HistoryLoadedSuccessAction { type: ActionType.HISTORY_LOADED_SUCCESS; payload: { file: TFile; noteId: string | null; history: VersionHistoryEntry[] }; }
export interface ClearActiveNoteAction { type: ActionType.CLEAR_ACTIVE_NOTE; }

export interface SetProcessingAction { type: ActionType.SET_PROCESSING; payload: boolean; }
export interface OpenPanelAction { type: ActionType.OPEN_PANEL; payload: NonNullable<PanelState>; }
export interface ClosePanelAction { type: ActionType.CLOSE_PANEL; }
export interface UpdateNoteIdInStateAction { type: ActionType.UPDATE_NOTE_ID_IN_STATE; payload: { noteId: string } }

export interface AddVersionSuccessAction { type: ActionType.ADD_VERSION_SUCCESS; payload: { newVersion: VersionHistoryEntry }; }
export interface StartVersionEditingAction { type: ActionType.START_VERSION_EDITING; payload: { versionId: string }; }
export interface StopVersionEditingAction { type: ActionType.STOP_VERSION_EDITING; }
export interface UpdateVersionDetailsInStateAction { type: ActionType.UPDATE_VERSION_DETAILS_IN_STATE; payload: { versionId: string; name?: string; }; }

// Search/sort interfaces
export interface ToggleSearchAction { type: ActionType.TOGGLE_SEARCH; payload: boolean; }
export interface SetSearchQueryAction { type: ActionType.SET_SEARCH_QUERY; payload: string; }
export interface SetSearchCaseSensitivityAction { type: ActionType.SET_SEARCH_CASE_SENSITIVITY; payload: boolean; }
export interface SetSortOrderAction { type: ActionType.SET_SORT_ORDER; payload: SortOrder; }

// Diff interfaces
export interface SetHighlightedVersionAction { type: ActionType.SET_HIGHLIGHTED_VERSION; payload: { versionId: string | null }; }
export interface StartDiffGenerationAction { type: ActionType.START_DIFF_GENERATION; payload: { version1: VersionHistoryEntry; version2: DiffTarget }; }
export interface DiffGenerationSucceededAction { type: ActionType.DIFF_GENERATION_SUCCEEDED; payload: { version1Id: string; version2Id: string; diffChanges: Change[] }; }
export interface DiffGenerationFailedAction { type: ActionType.DIFF_GENERATION_FAILED; payload: { version1Id: string; version2Id: string }; }
export interface ClearDiffRequestAction { type: ActionType.CLEAR_DIFF_REQUEST; }

// Watch Mode UI interface
export interface SetWatchModeCountdownAction { type: ActionType.SET_WATCH_MODE_COUNTDOWN; payload: number | null; }


/**
 * @type Action
 * A discriminated union of all possible action interfaces.
 */
export type Action =
    | UpdateSettingsAction
    | ReportErrorAction
    | InitializeViewAction
    | HistoryLoadedSuccessAction
    | ClearActiveNoteAction
    | SetProcessingAction
    | OpenPanelAction
    | ClosePanelAction
    | UpdateNoteIdInStateAction
    | AddVersionSuccessAction
    | StartVersionEditingAction
    | StopVersionEditingAction
    | UpdateVersionDetailsInStateAction
    | ToggleSearchAction
    | SetSearchQueryAction
    | SetSearchCaseSensitivityAction
    | SetSortOrderAction
    | SetHighlightedVersionAction
    | StartDiffGenerationAction
    | DiffGenerationSucceededAction
    | DiffGenerationFailedAction
    | ClearDiffRequestAction
    | SetWatchModeCountdownAction;

// ===================================================================================
// ACTION CREATORS
// ===================================================================================
export const actions = {
    updateSettings: (payload: Partial<VersionControlSettings>): UpdateSettingsAction => ({ type: ActionType.UPDATE_SETTINGS, payload }),
    reportError: (payload: AppError): ReportErrorAction => ({ type: ActionType.REPORT_ERROR, payload }),

    initializeView: (payload: ActiveNoteInfo): InitializeViewAction => ({ type: ActionType.INITIALIZE_VIEW, payload }),
    historyLoadedSuccess: (payload: { file: TFile; noteId: string | null; history: VersionHistoryEntry[] }): HistoryLoadedSuccessAction => ({ type: ActionType.HISTORY_LOADED_SUCCESS, payload }),
    clearActiveNote: (): ClearActiveNoteAction => ({ type: ActionType.CLEAR_ACTIVE_NOTE }),

    setProcessing: (isProcessing: boolean): SetProcessingAction => ({ type: ActionType.SET_PROCESSING, payload: isProcessing }),
    closePanel: (): ClosePanelAction => ({ type: ActionType.CLOSE_PANEL }),
    
    openSettings: (): OpenPanelAction => ({ type: ActionType.OPEN_PANEL, payload: { type: 'settings' } }),
    openPreviewPanel: (payload: Omit<PreviewPanel, 'type'>): OpenPanelAction => ({ type: ActionType.OPEN_PANEL, payload: { ...payload, type: 'preview' } }),
    openConfirmation: (payload: Omit<ConfirmationPanel, 'type'>): OpenPanelAction => ({ type: ActionType.OPEN_PANEL, payload: { ...payload, type: 'confirmation' } }),
    openDiffPanel: (payload: Omit<DiffPanel, 'type'>): OpenPanelAction => ({ type: ActionType.OPEN_PANEL, payload: { ...payload, type: 'diff' } }),
    
    updateNoteIdInState: (noteId: string): UpdateNoteIdInStateAction => ({ type: ActionType.UPDATE_NOTE_ID_IN_STATE, payload: { noteId } }),

    addVersionSuccess: (newVersion: VersionHistoryEntry): AddVersionSuccessAction => ({ type: ActionType.ADD_VERSION_SUCCESS, payload: { newVersion } }),
    startVersionEditing: (versionId: string): StartVersionEditingAction => ({ type: ActionType.START_VERSION_EDITING, payload: { versionId } }),
    stopVersionEditing: (): StopVersionEditingAction => ({ type: ActionType.STOP_VERSION_EDITING }),
    updateVersionDetailsInState: (versionId: string, name?: string): UpdateVersionDetailsInStateAction => ({ type: ActionType.UPDATE_VERSION_DETAILS_IN_STATE, payload: { versionId, name } }),

    // Search/sort action creators
    toggleSearch: (isActive: boolean): ToggleSearchAction => ({ type: ActionType.TOGGLE_SEARCH, payload: isActive }),
    setSearchQuery: (query: string): SetSearchQueryAction => ({ type: ActionType.SET_SEARCH_QUERY, payload: query }),
    setSearchCaseSensitivity: (isCaseSensitive: boolean): SetSearchCaseSensitivityAction => ({ type: ActionType.SET_SEARCH_CASE_SENSITIVITY, payload: isCaseSensitive }),
    setSortOrder: (sortOrder: SortOrder): SetSortOrderAction => ({ type: ActionType.SET_SORT_ORDER, payload: sortOrder }),

    // Diff action creators
    setHighlightedVersion: (versionId: string | null): SetHighlightedVersionAction => ({ type: ActionType.SET_HIGHLIGHTED_VERSION, payload: { versionId } }),
    startDiffGeneration: (payload: { version1: VersionHistoryEntry; version2: DiffTarget }): StartDiffGenerationAction => ({ type: ActionType.START_DIFF_GENERATION, payload }),
    diffGenerationSucceeded: (payload: { version1Id: string; version2Id: string; diffChanges: Change[] }): DiffGenerationSucceededAction => ({ type: ActionType.DIFF_GENERATION_SUCCEEDED, payload }),
    diffGenerationFailed: (payload: { version1Id: string; version2Id: string }): DiffGenerationFailedAction => ({ type: ActionType.DIFF_GENERATION_FAILED, payload }),
    clearDiffRequest: (): ClearDiffRequestAction => ({ type: ActionType.CLEAR_DIFF_REQUEST }),

    // Watch Mode UI action creator
    setWatchModeCountdown: (countdown: number | null): SetWatchModeCountdownAction => ({ type: ActionType.SET_WATCH_MODE_COUNTDOWN, payload: countdown }),
};
