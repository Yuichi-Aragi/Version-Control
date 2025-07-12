import { TFile } from 'obsidian';
import { VersionControlSettings, VersionHistoryEntry, AppError, DiffTarget, DiffRequest } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { AppThunk } from './store';
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
    diffChanges: Change[] | null; // null while loading
}

export interface SettingsPanel {
    type: 'settings';
}

export type PanelState = ConfirmationPanel | PreviewPanel | DiffPanel | SettingsPanel | null;

// --- Core Application State ---

export type SortProperty = 'versionNumber' | 'timestamp' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortOrder {
    property: SortProperty;
    direction: SortDirection;
}

export interface AppState {
    status: AppStatus;
    settings: VersionControlSettings;
    error: AppError | null;
    
    // Properties for LOADING and READY states
    file: TFile | null; 
    noteId: string | null;
    history: VersionHistoryEntry[];
    
    // Properties primarily for READY state
    isProcessing: boolean;
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
        isProcessing: false,
        panel: null,
        namingVersionId: null,
        highlightedVersionId: null,
        isSearchActive: false,
        searchQuery: '',
        isSearchCaseSensitive: false,
        sortOrder: defaultSortOrder,
        diffRequest: null,
        watchModeCountdown: null,
    };
};
