import { TFile } from 'obsidian';
import type { EntityState } from '@reduxjs/toolkit';
import type { VersionControlSettings, HistorySettings, VersionHistoryEntry, AppError, DiffTarget, DiffRequest, DiffType, Change, TimelineEvent, TimelineSettings, ViewMode } from '@/types';
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
    content: string;
}

export interface DescriptionPanel {
    type: 'description';
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
    events: TimelineEvent[] | null; // null while loading
    settings: TimelineSettings;
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
    
    // History Data - Refactored to use EntityState for performance and normalization
    viewMode: ViewMode;
    history: EntityState<VersionHistoryEntry, string>; // Used for Versions
    editHistory: EntityState<VersionHistoryEntry, string>; // Used for Edits

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

// Helper to create initial entity state
const initialEntityState = { ids: [], entities: {} };

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
        viewMode: 'versions',
        history: initialEntityState,
        editHistory: initialEntityState,
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
