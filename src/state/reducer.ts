import { AppState, AppStatus, ReadyState, SortOrder } from './state';
import { Action, ActionType } from './actions';
import { VersionControlSettings } from '../types';

const settingsReducer = (currentSettings: VersionControlSettings, action: Action): VersionControlSettings => {
    if (action.type === ActionType.UPDATE_SETTINGS) {
        return { ...currentSettings, ...action.payload };
    }
    return currentSettings;
};

const readyStateReducer = (state: ReadyState, action: Action): AppState => {
    switch (action.type) {
        case ActionType.SET_PROCESSING:
            return { ...state, isProcessing: action.payload };

        case ActionType.OPEN_PANEL:
            return {
                ...state,
                panel: action.payload,
                isProcessing: false,
                namingVersionId: null,
                isSearchActive: false,
                searchQuery: '',
            };

        case ActionType.CLOSE_PANEL:
            return { ...state, panel: null };
        
        case ActionType.UPDATE_NOTE_ID_IN_STATE:
            return { ...state, noteId: action.payload.noteId };

        case ActionType.ADD_VERSION_SUCCESS: {
            const newHistory = [action.payload.newVersion, ...state.history];
            const namingVersionId = state.settings.enableVersionNaming ? action.payload.newVersion.id : null;
            return {
                ...state,
                history: newHistory,
                isProcessing: false,
                namingVersionId: namingVersionId,
            };
        }

        case ActionType.START_VERSION_EDITING:
            return { ...state, namingVersionId: action.payload.versionId };

        case ActionType.STOP_VERSION_EDITING:
            return { ...state, namingVersionId: null };

        case ActionType.UPDATE_VERSION_DETAILS_IN_STATE: {
            const newHistory = state.history.map(v => 
                v.id === action.payload.versionId ? { ...v, name: action.payload.name, tags: action.payload.tags } : v
            );
            return { ...state, history: newHistory };
        }

        case ActionType.HISTORY_LOADED_SUCCESS:
            if (state.file.path === action.payload.file.path) {
                return {
                    ...state,
                    history: action.payload.history,
                    noteId: action.payload.noteId,
                    isProcessing: false,
                    panel: null,
                    namingVersionId: null,
                    highlightedVersionId: null,
                    expandedTagIds: [], // Reset on history load
                };
            }
            return state;

        case ActionType.CLEAR_ACTIVE_NOTE:
            return {
                status: AppStatus.PLACEHOLDER,
                settings: state.settings,
            };

        case ActionType.TOGGLE_SEARCH:
            if (action.payload) {
                return {
                    ...state,
                    isSearchActive: true,
                    panel: null,
                    isSearchCaseSensitive: false,
                };
            } else {
                return {
                    ...state,
                    isSearchActive: false,
                    searchQuery: '',
                    isSearchCaseSensitive: false,
                };
            }

        case ActionType.SET_SEARCH_QUERY:
            return { ...state, searchQuery: action.payload };

        case ActionType.SET_SEARCH_CASE_SENSITIVITY:
            return { ...state, isSearchCaseSensitive: action.payload };

        case ActionType.SET_SORT_ORDER:
            return { ...state, sortOrder: action.payload };

        case ActionType.TOGGLE_TAG_EXPANSION: {
            const { versionId } = action.payload;
            const newExpandedIds = new Set(state.expandedTagIds);
            if (newExpandedIds.has(versionId)) {
                newExpandedIds.delete(versionId);
            } else {
                newExpandedIds.add(versionId);
            }
            return { ...state, expandedTagIds: Array.from(newExpandedIds) };
        }

        case ActionType.SET_HIGHLIGHTED_VERSION:
            return { ...state, highlightedVersionId: action.payload.versionId };

        case ActionType.START_DIFF_GENERATION:
            return {
                ...state,
                diffRequest: {
                    status: 'generating',
                    version1: action.payload.version1,
                    version2: action.payload.version2,
                    diffChanges: null,
                },
                panel: null, // Close any open panel when starting a diff
            };

        case ActionType.DIFF_GENERATION_SUCCEEDED:
            if (state.diffRequest && state.diffRequest.version1.id === action.payload.version1Id && state.diffRequest.version2.id === action.payload.version2Id) {
                return {
                    ...state,
                    diffRequest: {
                        ...state.diffRequest,
                        status: 'ready',
                        diffChanges: action.payload.diffChanges,
                    }
                };
            }
            return state;

        case ActionType.DIFF_GENERATION_FAILED:
            if (state.diffRequest && state.diffRequest.version1.id === action.payload.version1Id && state.diffRequest.version2.id === action.payload.version2Id) {
                return { ...state, diffRequest: null };
            }
            return state;
        
        case ActionType.CLEAR_DIFF_REQUEST:
            return { ...state, diffRequest: null };

        default:
            return state;
    }
};

export const rootReducer = (state: AppState, action: Action): AppState => {
    if (action.type === ActionType.REPORT_ERROR) {
        return {
            status: AppStatus.ERROR,
            settings: state.settings,
            error: action.payload,
        };
    }

    const newSettings = settingsReducer(state.settings, action);
    if (newSettings !== state.settings) {
        return { ...state, settings: newSettings };
    }

    if (action.type === ActionType.INITIALIZE_VIEW) {
        const { file: newActiveFile } = action.payload;

        if (!newActiveFile) {
            return { status: AppStatus.PLACEHOLDER, settings: state.settings };
        }

        if (state.status === AppStatus.READY && state.file.path === newActiveFile.path && !state.isProcessing) {
            if (state.noteId === action.payload.noteId && action.payload.source !== 'manifest') {
                 return state;
            }
        }
        
        return {
            status: AppStatus.LOADING,
            settings: state.settings,
            file: newActiveFile,
        };
    }

    switch (state.status) {
        case AppStatus.INITIALIZING:
            if (action.type === ActionType.CLEAR_ACTIVE_NOTE) {
                return { status: AppStatus.PLACEHOLDER, settings: state.settings };
            }
            return state;

        case AppStatus.LOADING:
            if (action.type === ActionType.HISTORY_LOADED_SUCCESS) {
                if (state.file.path === action.payload.file.path) {
                    const defaultSortOrder: SortOrder = { property: 'versionNumber', direction: 'desc' };
                    return {
                        status: AppStatus.READY,
                        settings: state.settings,
                        file: action.payload.file,
                        noteId: action.payload.noteId,
                        history: action.payload.history,
                        isProcessing: false,
                        panel: null,
                        namingVersionId: null,
                        highlightedVersionId: null,
                        isSearchActive: false,
                        searchQuery: '',
                        isSearchCaseSensitive: false,
                        sortOrder: defaultSortOrder,
                        diffRequest: null,
                        expandedTagIds: [],
                    };
                }
            }
            if (action.type === ActionType.CLEAR_ACTIVE_NOTE) {
                return { status: AppStatus.PLACEHOLDER, settings: state.settings };
            }
            return state;

        case AppStatus.READY:
            return readyStateReducer(state, action);

        case AppStatus.PLACEHOLDER:
        case AppStatus.ERROR:
            if (action.type === ActionType.CLEAR_ACTIVE_NOTE) {
                return { status: AppStatus.PLACEHOLDER, settings: state.settings };
            }
            return state;
        
        default:
            console.warn("Version Control: Unhandled state in rootReducer", state);
            return state;
    }
};
