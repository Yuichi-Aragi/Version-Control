import { TFile } from 'obsidian';
import { VersionControlSettings, VersionHistoryEntry, ActiveNoteState as ActiveNoteInfo } from '../types';
import { ConfirmationState, PreviewState } from './state';

export enum ActionType {
    // Settings
    UPDATE_SETTINGS = 'UPDATE_SETTINGS',

    // Active Note
    SET_ACTIVE_NOTE = 'SET_ACTIVE_NOTE',
    LOAD_HISTORY_START = 'LOAD_HISTORY_START',
    LOAD_HISTORY_SUCCESS = 'LOAD_HISTORY_SUCCESS',
    CLEAR_ACTIVE_NOTE = 'CLEAR_ACTIVE_NOTE',

    // UI
    TOGGLE_NAME_INPUT = 'TOGGLE_NAME_INPUT',
    TOGGLE_SETTINGS_PANEL = 'TOGGLE_SETTINGS_PANEL',
    SHOW_CONFIRMATION = 'SHOW_CONFIRMATION',
    HIDE_CONFIRMATION = 'HIDE_CONFIRMATION',
    SHOW_PREVIEW = 'SHOW_PREVIEW',
    HIDE_PREVIEW = 'HIDE_PREVIEW',
    SET_PROCESSING_STATE = 'SET_PROCESSING_STATE',
}

// Action interfaces
export interface UpdateSettingsAction { type: ActionType.UPDATE_SETTINGS; payload: Partial<VersionControlSettings>; }
export interface SetActiveNoteAction { type: ActionType.SET_ACTIVE_NOTE; payload: ActiveNoteInfo; }
export interface LoadHistoryStartAction { type: ActionType.LOAD_HISTORY_START; }
export interface LoadHistorySuccessAction { type: ActionType.LOAD_HISTORY_SUCCESS; payload: VersionHistoryEntry[]; }
export interface ClearActiveNoteAction { type: ActionType.CLEAR_ACTIVE_NOTE; }
export interface ToggleNameInputAction { type: ActionType.TOGGLE_NAME_INPUT; payload: boolean; }
export interface ToggleSettingsPanelAction { type: ActionType.TOGGLE_SETTINGS_PANEL; }
export interface ShowConfirmationAction { type: ActionType.SHOW_CONFIRMATION; payload: Omit<ConfirmationState, 'isOpen'>; }
export interface HideConfirmationAction { type: ActionType.HIDE_CONFIRMATION; }
export interface ShowPreviewAction { type: ActionType.SHOW_PREVIEW; payload: Omit<PreviewState, 'isOpen'>; }
export interface HidePreviewAction { type: ActionType.HIDE_PREVIEW; }
export interface SetProcessingStateAction { type: ActionType.SET_PROCESSING_STATE; payload: boolean; }


// Union type for all possible actions
export type Action =
    | UpdateSettingsAction
    | SetActiveNoteAction
    | LoadHistoryStartAction
    | LoadHistorySuccessAction
    | ClearActiveNoteAction
    | ToggleNameInputAction
    | ToggleSettingsPanelAction
    | ShowConfirmationAction
    | HideConfirmationAction
    | ShowPreviewAction
    | HidePreviewAction
    | SetProcessingStateAction;

/**
 * A collection of action creator functions. These are the only way to generate
 * actions that can be dispatched to the store.
 */
export const actions = {
    updateSettings: (payload: Partial<VersionControlSettings>): UpdateSettingsAction => ({ type: ActionType.UPDATE_SETTINGS, payload }),
    setActiveNote: (payload: ActiveNoteInfo): SetActiveNoteAction => ({ type: ActionType.SET_ACTIVE_NOTE, payload }),
    loadHistoryStart: (): LoadHistoryStartAction => ({ type: ActionType.LOAD_HISTORY_START }),
    loadHistorySuccess: (payload: VersionHistoryEntry[]): LoadHistorySuccessAction => ({ type: ActionType.LOAD_HISTORY_SUCCESS, payload }),
    clearActiveNote: (): ClearActiveNoteAction => ({ type: ActionType.CLEAR_ACTIVE_NOTE }),
    toggleNameInput: (payload: boolean): ToggleNameInputAction => ({ type: ActionType.TOGGLE_NAME_INPUT, payload }),
    toggleSettingsPanel: (): ToggleSettingsPanelAction => ({ type: ActionType.TOGGLE_SETTINGS_PANEL }),
    showConfirmation: (payload: Omit<ConfirmationState, 'isOpen'>): ShowConfirmationAction => ({ type: ActionType.SHOW_CONFIRMATION, payload }),
    hideConfirmation: (): HideConfirmationAction => ({ type: ActionType.HIDE_CONFIRMATION }),
    showPreview: (payload: Omit<PreviewState, 'isOpen'>): ShowPreviewAction => ({ type: ActionType.SHOW_PREVIEW, payload }),
    hidePreview: (): HidePreviewAction => ({ type: ActionType.HIDE_PREVIEW }),
    setProcessingState: (payload: boolean): SetProcessingStateAction => ({ type: ActionType.SET_PROCESSING_STATE, payload }),
};