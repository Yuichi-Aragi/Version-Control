/**
 * State Utilities Module
 *
 * This module provides utility functions for state management operations.
 *
 * @module state/utils
 *
 * ## Utilities
 *
 * - **settingsUtils**: Settings resolution and merging utilities
 *
 * ## Usage
 *
 * ```typescript
 * import { resolveEffectiveSettings, mergeSettings } from '@/state/utils';
 *
 * // Resolve effective settings for a note and branch
 * const settings = await resolveEffectiveSettings(noteId, branchName, type);
 *
 * // Merge global and local settings
 * const merged = mergeSettings(globalSettings, localOverrides);
 * ```
 */

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export * from './settingsUtils';

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
