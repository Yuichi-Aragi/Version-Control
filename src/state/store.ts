import { configureStore, ThunkAction, Action } from '@reduxjs/toolkit';
import { Container } from 'inversify';
import { AppState } from './state';
import { appSlice } from './appSlice';

/**
 * Creates and configures the Redux Toolkit store for the application.
 * @param preloadedState The initial state of the application.
 * @param container The dependency injection container, passed as an extra argument to thunks.
 * @returns The configured Redux store.
 */
export const createAppStore = (preloadedState: AppState, container: Container) => {
    return configureStore({
        reducer: appSlice.reducer,
        preloadedState,
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                // We need to disable serializability checks for TFile and other non-serializable data
                // that we store in the state. This is a trade-off for convenience in this specific app.
                serializableCheck: false,
                thunk: {
                    extraArgument: container,
                },
            }),
    });
};

// Core types for the Redux store, derived from the store itself.
export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

/**
 * The standard thunk type for this application. It is pre-typed with the RootState,
 * the dependency container as the extra argument, and a standard Action type.
 */
export type AppThunk<ReturnType = void> = ThunkAction<
    ReturnType,
    RootState,
    Container,
    Action<string>
>;