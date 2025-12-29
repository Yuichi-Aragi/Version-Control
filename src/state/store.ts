import { configureStore } from '@reduxjs/toolkit';
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { appSlice } from './appSlice';
import { changelogApi } from './apis/changelog.api';
import type { AppState } from './state';
import type { ServiceRegistry } from '@/services-registry';

/**
 * Creates and configures the Redux Toolkit store for the application.
 * @param preloadedAppState The initial state of the application app slice.
 * @param services The service registry, passed as an extra argument to thunks.
 * @returns The configured Redux store.
 */
export const createAppStore = (preloadedAppState: AppState, services: ServiceRegistry) => {
    return configureStore({
        reducer: {
            app: appSlice.reducer,
            [changelogApi.reducerPath]: changelogApi.reducer,
        },
        preloadedState: {
            app: preloadedAppState,
        },
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                // We need to disable serializability checks for TFile and other non-serializable data
                // that we store in the state. This is a trade-off for convenience in this specific app.
                serializableCheck: false,
                thunk: {
                    extraArgument: services,
                },
            }).concat(changelogApi.middleware),
    });
};

// Core types for the Redux store, derived from the store itself.
export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

/**
 * Type alias for ServiceRegistry, used throughout the application for
 * dependency injection without inversify.
 */
export type Services = ServiceRegistry;

/**
 * Configuration type for createAsyncThunk.
 * Ensures all async thunks have consistent typing for state, extra args (services), and rejection.
 */
export interface ThunkConfig {
    state: RootState;
    extra: Services;
    rejectValue: string; // Standardize error messages as strings for rejection
}

/**
 * The standard thunk type for this application. It is pre-typed with the RootState,
 * the service registry as the extra argument, and a standard Action type.
 * Used for legacy or simple synchronous thunks that don't require createAsyncThunk.
 */
export type AppThunk<ReturnType = void> = ThunkAction<
    ReturnType,
    RootState,
    ServiceRegistry,
    UnknownAction
>;
