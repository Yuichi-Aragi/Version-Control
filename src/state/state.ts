import { TFile } from 'obsidian';
import type { VersionControlSettings, VersionHistoryEntry, AppError, DiffTarget, DiffRequest, DiffType } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import type { AppThunk } from './store';
import type { Change } from 'diff';

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

// --- Panel States (Nested within AppState) ---

export interface ConfirmationPanel {
    type: 'confirmation';
    title: string;
    message: string;
    onConfirmAction: AppThunk; // Thunk to execute on confirmation
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
    diffChanges: Change[] | null; // null while loading initial diff
    diffType: DiffType;
    content1: string;
    content2: string;
    isReDiffing?: boolean;
}

export interface SettingsPanel {
    type: 'settings';
}

export interface ChangelogPanel {
    type: 'changelog';
    content: string | null; // null while loading
}

/** A generic item for the ActionPanel. */
export interface ActionItem<T> {
    id: string;
    data: T; // The actual data associated with the item
    text: string;
    subtext?: string;
    icon?: string;
    /** Whether the item represents the currently active/selected state. */
    isSelected?: boolean;
}

/** A generic panel for presenting a list of choices to the user. */
export interface ActionPanel<T> {
    type: 'action';
    title: string;
    items: ActionItem<T>[];
    onChooseAction: (data: T) => AppThunk;
    // Optional handler for when user tries to create a new item from the filter input
    onCreateAction?: (value: string) => AppThunk;
    showFilter?: boolean; // Whether to show a filter/search input.
}

export type PanelState = ConfirmationPanel | PreviewPanel | DiffPanel | SettingsPanel | ActionPanel<any> | ChangelogPanel | null;

// --- Core Application State ---

export type SortProperty = 'versionNumber' | 'timestamp' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortOrder {
    property: SortProperty;
    direction: SortDirection;
}

export interface KeyUpdateProgress {
    active: boolean;
    progress: number;
    total: number;
    message: string;
}

export interface AppState {
    status: AppStatus;
    settings: VersionControlSettings;
    error: AppError | null;
    
    // Properties for LOADING and READY states
    file: TFile | null; 
    noteId: string | null;
    history: VersionHistoryEntry[];
    currentBranch: string | null;
    availableBranches: string[];
    
    // Properties primarily for READY state
    isProcessing: boolean;
    isRenaming: boolean; // Flag to block operations during DB rename
    panel: PanelState;
    namingVersionId: string | null;
    highlightedVersionId: string | null;
    
    // Search and sort properties
    isSearchActive: boolean;
    searchQuery: string;
    isSearchCaseSensitive: boolean;
    sortOrder: SortOrder;

    // Diff properties
    diffRequest: DiffRequest | null;

    // Watch Mode properties
    watchModeCountdown: number | null;

    // Key update progress
    keyUpdateProgress: KeyUpdateProgress | null;
}

export const getInitialState = (loadedSettings: VersionControlSettings): AppState => {
    const defaultSortOrder: SortOrder = { property: 'versionNumber', direction: 'desc' };
    return {
        status: AppStatus.INITIALIZING,
        settings: { ...DEFAULT_SETTINGS, ...loadedSettings },
        error: null,
        file: null,
        noteId: null,
        history: [],
        currentBranch: null,
        availableBranches: [],
        isProcessing: false,
        isRenaming: false,
        panel: null,
        namingVersionId: null,
        highlightedVersionId: null,
        isSearchActive: false,
        searchQuery: '',
        isSearchCaseSensitive: false,
        sortOrder: defaultSortOrder,
        diffRequest: null,
        watchModeCountdown: null,
        keyUpdateProgress: null,
    };
};