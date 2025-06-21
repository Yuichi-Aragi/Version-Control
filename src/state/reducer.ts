import { AppState, UIState, ActiveNoteState } from './state';
import { Action, ActionType } from './actions';

const settingsReducer = (state: AppState['settings'], action: Action): AppState['settings'] => {
    switch (action.type) {
        case ActionType.UPDATE_SETTINGS:
            return { ...state, ...action.payload };
        default:
            return state;
    }
};

const uiReducer = (state: UIState, action: Action): UIState => {
    switch (action.type) {
        // --- Panel Logic ---
        // This logic ensures that all overlay panels are mutually exclusive.
        // Showing one will automatically hide all others, preventing UI conflicts.

        case ActionType.TOGGLE_NAME_INPUT:
            return {
                ...state,
                isNameInputVisible: action.payload,
                isSettingsPanelOpen: false,
                preview: { ...state.preview, isOpen: false },
                confirmation: { ...state.confirmation, isOpen: false },
            };

        case ActionType.TOGGLE_SETTINGS_PANEL:
            const isOpeningSettings = !state.isSettingsPanelOpen;
            return {
                ...state,
                isSettingsPanelOpen: isOpeningSettings,
                isNameInputVisible: false,
                preview: { ...state.preview, isOpen: false },
                confirmation: { ...state.confirmation, isOpen: false },
            };

        case ActionType.SHOW_CONFIRMATION:
            return {
                ...state,
                confirmation: { ...action.payload, isOpen: true },
                preview: { ...state.preview, isOpen: false },
                isNameInputVisible: false,
                isSettingsPanelOpen: false,
            };

        case ActionType.HIDE_CONFIRMATION:
            return { ...state, confirmation: { ...state.confirmation, isOpen: false } };

        case ActionType.SHOW_PREVIEW:
            return {
                ...state,
                preview: { ...action.payload, isOpen: true },
                confirmation: { ...state.confirmation, isOpen: false },
                isNameInputVisible: false,
                isSettingsPanelOpen: false,
            };

        case ActionType.HIDE_PREVIEW:
            return { ...state, preview: { ...state.preview, isOpen: false } };

        // --- Primary ViewMode Logic ---
        // This logic controls the main content area of the view, independent of the overlay panels.
        case ActionType.LOAD_HISTORY_START:
            return { ...state, viewMode: 'loading' };
        case ActionType.LOAD_HISTORY_SUCCESS:
            return { ...state, viewMode: 'history' };
        case ActionType.CLEAR_ACTIVE_NOTE:
            // When the note is cleared, reset the UI to its initial placeholder state.
            return { 
                ...state, 
                viewMode: 'placeholder',
                isNameInputVisible: false,
                isSettingsPanelOpen: false,
                isProcessing: false, // Ensure processing state is reset
                confirmation: { ...state.confirmation, isOpen: false },
                preview: { ...state.preview, isOpen: false },
            };
        
        // --- Global Processing State ---
        case ActionType.SET_PROCESSING_STATE:
            return { ...state, isProcessing: action.payload };
            
        default:
            return state;
    }
};

const activeNoteReducer = (state: ActiveNoteState, action: Action): ActiveNoteState => {
    switch (action.type) {
        case ActionType.SET_ACTIVE_NOTE:
            // When setting a new note, only update file/id. History is loaded separately.
            return { ...state, file: action.payload.file, noteId: action.payload.noteId };
        case ActionType.LOAD_HISTORY_START:
            // Clear previous history and set loading flag.
            return { ...state, isLoadingHistory: true, history: [] };
        case ActionType.LOAD_HISTORY_SUCCESS:
            // Populate history and clear loading flag.
            return { ...state, isLoadingHistory: false, history: action.payload };
        case ActionType.CLEAR_ACTIVE_NOTE:
            // Reset to the initial empty state.
            return { file: null, noteId: null, history: [], isLoadingHistory: false };
        default:
            return state;
    }
};

/**
 * The root reducer combines all other reducers into a single function.
 * It is a pure function that computes the next state tree based on the
 * previous state and the dispatched action.
 * @param state The current application state.
 * @param action The dispatched action.
 * @returns The new application state.
 */
export const rootReducer = (state: AppState, action: Action): AppState => {
    const newSettings = settingsReducer(state.settings, action);
    const newUi = uiReducer(state.ui, action);
    const newActiveNote = activeNoteReducer(state.activeNote, action);

    // If no slice of the state has changed, return the original state object.
    // This is a critical optimization that prevents unnecessary re-renders in subscribed components.
    if (
        newSettings === state.settings &&
        newUi === state.ui &&
        newActiveNote === state.activeNote
    ) {
        return state;
    }

    return {
        settings: newSettings,
        ui: newUi,
        activeNote: newActiveNote,
    };
};