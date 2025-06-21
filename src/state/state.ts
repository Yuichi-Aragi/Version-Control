import { TFile } from 'obsidian';
import { VersionControlSettings, VersionHistoryEntry } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { Action } from './actions';
import { Thunk } from './store';

/**
 * Defines the primary view state.
 * - placeholder: No active note is selected.
 * - loading: Actively fetching history for a note.
 * - history: Displaying the version history for the active note.
 */
export type ViewMode = 'placeholder' | 'loading' | 'history';

/**
 * Represents the state of the confirmation panel.
 */
export interface ConfirmationState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirmAction: Action | Thunk | null;
}

/**
 * Represents the state of the version preview panel.
 */
export interface PreviewState {
    isOpen: boolean;
    version: VersionHistoryEntry | null;
    content: string;
}

/**
 * Encapsulates all UI-related state. This drives the entire visual
 * representation of the plugin view, ensuring the DOM is always a
 * direct reflection of this state.
 */
export interface UIState {
    viewMode: ViewMode;
    isNameInputVisible: boolean;
    isSettingsPanelOpen: boolean;
    isProcessing: boolean;
    confirmation: ConfirmationState;
    preview: PreviewState;
}

/**
 * Holds all state related to the currently active, version-controlled note.
 */
export interface ActiveNoteState {
    file: TFile | null;
    noteId: string | null;
    history: VersionHistoryEntry[];
    isLoadingHistory: boolean;
}

/**
 * The root state of the entire application. This is the single source of truth.
 */
export interface AppState {
    settings: VersionControlSettings;
    ui: UIState;
    activeNote: ActiveNoteState;
}

/**
 * Creates the initial state of the application when the plugin loads.
 * @param loadedSettings Settings loaded from disk.
 * @returns The complete initial AppState.
 */
export const getInitialState = (loadedSettings: VersionControlSettings): AppState => ({
    settings: { ...DEFAULT_SETTINGS, ...loadedSettings },
    ui: {
        viewMode: 'placeholder',
        isNameInputVisible: false,
        isSettingsPanelOpen: false,
        isProcessing: false,
        confirmation: {
            isOpen: false,
            title: '',
            message: '',
            onConfirmAction: null,
        },
        preview: {
            isOpen: false,
            version: null,
            content: '',
        },
    },
    activeNote: {
        file: null,
        noteId: null,
        history: [],
        isLoadingHistory: false,
    },
});