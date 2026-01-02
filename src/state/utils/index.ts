/**
 * State Utilities Module
 *
 * This module provides utility functions for state management operations.
 *
 * @module state/utils
 *
 * ## Utilities
 *
 * - **guards**: Race condition prevention and lifecycle guards
 * - **settingsUtils**: Settings resolution and merging utilities
 * - **thunk-validation**: Common validation logic for thunks
 */

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export * from './guards';
export * from './settingsUtils';
export * from './thunk-validation';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { HistorySettings } from '@/types';

/**
 * Settings resolution context.
 */
export interface SettingsContext {
    noteId: string;
    branchName: string;
    type: 'version' | 'edit';
}

/**
 * Result of settings resolution.
 */
export interface ResolvedSettings extends HistorySettings {
    isGlobal: boolean;
    source: 'global' | 'branch' | 'merged';
}
