import { TFile } from 'obsidian';
import type { VersionControlSettings, HistorySettings, VersionHistoryEntry, AppError, DiffTarget, DiffRequest, DiffType, ViewMode } from '@/types';
export type { TimelineEvent } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';
import type { AppThunk } from './store';

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
}

export interface DescriptionPanel {
    type: 'description';
}

export interface DiffPanel {
    type: 'diff';
    version1: VersionHistoryEntry;
    version2: DiffTarget;
    diffType: DiffType;
    renderMode?: 'panel' | 'window';
}

export interface SettingsPanel {
    type: 'settings';
}

export interface ChangelogPanel {
    type: 'changelog';
}

export interface TimelinePanel {
    type: 'timeline';
    // Data is now managed by RTK Query (historyApi)
}

export interface DashboardPanel {
    type: 'dashboard';
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
    /**
     * Optional context actions for items (e.g., right-click menu).
     * Returns a list of actions where the data is the action ID.
     */
    contextActions?: (item: ActionItem<T>) => ActionItem<string>[];
    /**
     * Handler for when a context action is chosen.
     */
    onContextAction?: (actionId: string, itemData: T) => AppThunk;
}

/** A state for stacking an overlay panel (like confirmation) on top of the description panel. */
export interface StackedPanel {
    type: 'stacked';
    base: DescriptionPanel;
    overlay: ActionPanel<any> | ConfirmationPanel;
}

export type PanelState = ConfirmationPanel | PreviewPanel | DiffPanel | SettingsPanel | ActionPanel<any> | ChangelogPanel | DescriptionPanel | TimelinePanel | DashboardPanel | StackedPanel | null;

// --- Core Application State ---

export type SortProperty = 'versionNumber' | 'timestamp' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortOrder {
    property: SortProperty;
    direction: SortDirection;
}

export interface AppState {
    status: AppStatus;
    
    /**
     * Monotonically increasing counter that tracks the "version" of the current view context.
     * Incremented whenever the active note, view mode, or branch changes.
     * Used to invalidate stale async operations and prevent race conditions.
     */
    contextVersion: number;

    settings: VersionControlSettings & {
        enableMinLinesChangedCheck?: boolean;
        minLinesChanged?: number;
        renderMarkdownInPreview?: boolean;
        isGlobal?: boolean;
    };
    
    // Effective settings for the current context (Note + Branch + ViewMode)
    effectiveSettings: HistorySettings;

    error: AppError | null;
    
    // Properties for LOADING and READY states
    file: TFile | null; 
    noteId: string | null;
    
    /**
     * Tracks the last active note ID to preserve view mode and settings
     * when the view is temporarily cleared (e.g. mobile sidebar toggle).
     */
    lastNoteId: string | null;

    /**
     * Tracks the last active file path to preserve view mode when the view
     * is re-initialized before the note ID is resolved (e.g. unregistered notes).
     */
    lastFilePath: string | null;
    
    viewMode: ViewMode;
    // History lists are now managed by RTK Query (historyApi)

    currentBranch: string | null;
    availableBranches: string[];
    
    // Properties primarily for READY state
    isProcessing: boolean;
    isRenaming: boolean; // Flag to block operations during DB rename
    panel: PanelState;
    namingVersionId: string | null;
    isManualVersionEdit: boolean; // Distinguishes manual edit from post-save edit
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
}

export const getInitialState = (loadedSettings: VersionControlSettings): AppState => {
    const defaultSortOrder: SortOrder = { property: 'versionNumber', direction: 'desc' };
    return {
        status: AppStatus.INITIALIZING,
        contextVersion: 0,
        settings: { ...DEFAULT_SETTINGS, ...loadedSettings },
        effectiveSettings: DEFAULT_SETTINGS.versionHistorySettings, // Default start
        error: null,
        file: null,
        noteId: null,
        lastNoteId: null,
        lastFilePath: null,
        viewMode: 'versions',
        currentBranch: null,
        availableBranches: [],
        isProcessing: false,
        isRenaming: false,
        panel: null,
        namingVersionId: null,
        isManualVersionEdit: false,
        highlightedVersionId: null,
        isSearchActive: false,
        searchQuery: '',
        isSearchCaseSensitive: false,
        sortOrder: defaultSortOrder,
        diffRequest: null,
        watchModeCountdown: null,
    };
};

/**
 * Root State Definition
 * Explicitly defines the structure of the Redux store state.
 */
export interface RootState {
    app: AppState;
    [key: string]: any; // Allow for dynamic keys like changelogApi.reducerPath
}
