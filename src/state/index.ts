/**
 * State Management Module
 *
 * This module provides Redux Toolkit-based state management for the plugin.
 * It exports the store factory, slice definitions, thunks, and state types.
 *
 * @module state
 *
 * ## Architecture
 *
 * The state layer uses Redux Toolkit with:
 *
 * - **AppStore**: Configured Redux store instance
 * - **appSlice**: Main slice containing application state and reducers
 * - **thunks**: Async thunks for side-effect operations
 * - **State enums**: AppStatus for lifecycle tracking
 *
 * ## State Shape
 *
 * ```typescript
 * interface RootState {
 *   noteId: string | null;
 *   status: AppStatus;
 *   viewMode: 'versions' | 'edits';
 *   effectiveSettings: HistorySettings | null;
 *   watchModeCountdown: number | null;
 *   // ... other state properties
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { createAppStore, appSlice, thunks, AppStatus } from '@/state';
 * import type { RootState, AppDispatch } from '@/state';
 *
 * // Create store
 * const store = createAppStore(container);
 *
 * // Dispatch actions
 * store.dispatch(appSlice.actions.setNoteId('note-123'));
 * store.dispatch(thunks.saveNewVersion({ isAuto: false }));
 * ```
 */

// ============================================================================
// STORE EXPORTS
// ============================================================================

export { createAppStore } from './store';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type { AppStore, RootState, AppDispatch, AppThunk, Services } from './store';

// ============================================================================
// SLICE EXPORTS
// ============================================================================

export { appSlice } from './appSlice';

// ============================================================================
// STATE RE-EXPORTS
// ============================================================================

export * from './state';

// ============================================================================
// THUNK EXPORTS
// ============================================================================

export { thunks } from './thunks';
