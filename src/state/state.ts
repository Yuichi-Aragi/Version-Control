import { TFile } from 'obsidian';
import { VersionControlSettings, VersionHistoryEntry, AppError, DiffTarget, DiffRequest } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { Thunk } from './store';
import { Change } from 'diff';

// ===================================================================================
// FORMAL STATE MACHINE DEFINITION
// ===================================================================================

/**
 * @enum AppStatus
 * Defines the possible top-level statuses of the Version Control application.
 */
export enum AppStatus {
    INITIALIZING = 'INITIALIZING',
    PLACEHOLDER = 'PLACEHOLDER',
    LOADING = 'LOADING', // Actively fetching history for a specific note
    READY = 'READY',     // History loaded, UI interactive for a specific note
    ERROR = 'ERROR',
}

// --- Panel States (Nested within ReadyState) ---

export interface ConfirmationPanel {
    type: 'confirmation';
    title: string;
    message: string;
    onConfirmAction: Thunk; // Thunk to execute on confirmation
}

export interface PreviewPanel {
    type: 'preview';
    version: VersionHistoryEntry;
    content: string;
}

export interface DiffPanel {
    type: 'diff';
    version1: VersionHistoryEntry;
    version2: DiffTarget;
    diffChanges: Change[] | null; // null while loading
}

export interface SettingsPanel {
    type: 'settings';
}

export type PanelState = ConfirmationPanel | PreviewPanel | DiffPanel | SettingsPanel | null;


// --- Core Application States ---

export interface InitializingState {
    status: AppStatus.INITIALIZING;
    settings: VersionControlSettings;
}

export interface PlaceholderState {
    status: AppStatus.PLACEHOLDER;
    settings: VersionControlSettings;
}

export interface LoadingState {
    status: AppStatus.LOADING;
    settings: VersionControlSettings;
    file: TFile; // The file whose history is being loaded
}

export type SortProperty = 'versionNumber' | 'timestamp' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortOrder {
    property: SortProperty;
    direction: SortDirection;
}

export interface ReadyState {
    status: AppStatus.READY;
    settings: VersionControlSettings;
    file: TFile; // The currently active and version-controlled file
    noteId: string | null; // VC-ID of the note, null if not yet versioned
    history: VersionHistoryEntry[];
    isProcessing: boolean; // True if a background operation (save, restore, etc.) is in progress
    panel: PanelState; // State of any active overlay panel
    namingVersionId: string | null; // ID of the version currently being named inline
    highlightedVersionId: string | null; // ID of version to highlight temporarily
    
    // Search and sort properties
    isSearchActive: boolean;
    searchQuery: string;
    isSearchCaseSensitive: boolean;
    sortOrder: SortOrder;

    // Diff properties
    diffRequest: DiffRequest | null;
}

export interface ErrorState {
    status: AppStatus.ERROR;
    settings: VersionControlSettings;
    error: AppError; // Detailed error information
}

export type AppState =
    | InitializingState
    | PlaceholderState
    | LoadingState
    | ReadyState
    | ErrorState;

export const getInitialState = (loadedSettings: VersionControlSettings): AppState => ({
    status: AppStatus.INITIALIZING,
    settings: { ...DEFAULT_SETTINGS, ...loadedSettings },
});
