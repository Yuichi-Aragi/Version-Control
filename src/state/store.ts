import { AppState } from './state';
import { Action } from './actions';
import { rootReducer } from './reducer';
import VersionControlPlugin from '../main';

// A function that can be dispatched to perform async operations, with access to the plugin's core services.
export type Thunk = (
    dispatch: (action: Action | Thunk) => void,
    getState: () => AppState,
    plugin: VersionControlPlugin
) => void;

/**
 * An enterprise-grade state management machine.
 * Inspired by Redux, it provides a predictable state container for the plugin.
 * It supports synchronous state changes via reducers and asynchronous logic via thunks.
 * This is the single, central hub for all state transitions in the application.
 */
export class Store {
    private state: AppState;
    private listeners: Set<() => void> = new Set();
    private plugin: VersionControlPlugin;

    constructor(initialState: AppState, plugin: VersionControlPlugin) {
        this.state = initialState;
        this.plugin = plugin;
    }

    /**
     * Returns the current state tree of the application.
     * It is the single source of truth.
     * Defined as an arrow function to preserve `this` context.
     */
    public getState = (): AppState => {
        return this.state;
    };

    /**
     * Dispatches an action. This is the only way to trigger a state change.
     * The action can be a plain object that will be handled by a reducer,
     * or a thunk function for handling asynchronous logic.
     */
    public dispatch = (action: Action | Thunk): void => {
        if (typeof action === 'function') {
            // If it's a thunk, execute it with dispatch, getState, and the full plugin instance.
            action(this.dispatch, this.getState, this.plugin);
        } else {
            // For a plain action, calculate the new state using the root reducer.
            const oldState = this.state;
            this.state = rootReducer(this.state, action);
            
            // Notify listeners only if the state has actually changed to prevent unnecessary re-renders.
            if (oldState !== this.state) {
                this.notifyListeners();
            }
        }
    };

    /**
     * Adds a change listener. It will be called any time an action is dispatched and the state changes.
     * @param listener A callback to be invoked on every state change.
     * @returns A function to remove this listener.
     */
    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /**
     * Notifies all subscribed listeners that the state has changed.
     */
    private notifyListeners(): void {
        this.listeners.forEach(listener => listener());
    }
}