import { AppState } from './state';
import { Action } from './actions';
import { rootReducer } from './reducer';
import { DependencyContainer } from '../core/dependency-container';

/**
 * A thunk is a function that can perform asynchronous logic and dispatch
 * actions or other thunks. It receives the dispatch function, a function to
 * get the current state, and the dependency injection container to resolve services.
 */
export type Thunk = (
    dispatch: (actionOrThunk: Action | Thunk) => void,
    getState: () => AppState,
    container: DependencyContainer
) => void | Promise<void>; // Thunks can be async

/**
 * The central state container for the application, following Redux principles.
 * It holds the application state, allows state to be updated via dispatched
 * actions, and manages subscriptions to state changes.
 */
export class Store {
    private state: AppState;
    private listeners: Set<() => void> = new Set();
    private container: DependencyContainer;

    /**
     * @param initialState The initial state of the application.
     * @param container The dependency injection container, which thunks will use to resolve services.
     */
    constructor(initialState: AppState, container: DependencyContainer) {
        this.state = initialState;
        this.container = container;
    }

    /**
     * Returns the current state tree of the application.
     */
    public getState = (): AppState => {
        return this.state;
    };

    /**
     * Dispatches an action or a thunk. This is the only way to trigger a state change.
     * @param actionOrThunk The action object or thunk function to dispatch.
     */
    public dispatch = (actionOrThunk: Action | Thunk): void => {
        if (typeof actionOrThunk === 'function') {
            // It's a thunk. Execute it with dispatch, getState, and the DI container.
            const result = actionOrThunk(this.dispatch, this.getState, this.container);
            if (result instanceof Promise) {
                result.catch(error => {
                    console.error("Version Control: Unhandled error in async thunk:", error);
                });
            }
        } else {
            // It's a plain action. Pass it to the reducer to compute the new state.
            const oldState = this.state;
            this.state = rootReducer(this.state, actionOrThunk);
            
            if (oldState !== this.state) {
                this.notifyListeners();
            }
        }
    };

    /**
     * Adds a change listener. It will be called any time an action is dispatched,
     * and the state tree might have changed.
     * @param listener A callback to be invoked on every dispatch.
     * @returns A function to remove this listener.
     */
    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private notifyListeners(): void {
        Array.from(this.listeners).forEach(listener => {
            try {
                listener();
            } catch (error) {
                console.error("Version Control: Error in store listener:", error);
            }
        });
    }
}
