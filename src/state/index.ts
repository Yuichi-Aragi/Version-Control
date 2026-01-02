/**
 * State Management Module
 *
 * This module provides Redux Toolkit-based state management for the plugin.
 * It exports the store factory, slice definitions, thunks, and state types.
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
export { historyApi } from './apis/history.api';

// ============================================================================
// STATE RE-EXPORTS
// ============================================================================

export * from './state';

// ============================================================================
// THUNK EXPORTS
// ============================================================================

export { thunks } from './thunks';
