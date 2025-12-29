import type { RootState, Services } from '@/state/store';
import type { ViewMode } from '@/types';
// CRITICAL FIX: Import AppStatus from direct file to avoid circular dependency via index.ts -> appSlice
import { AppStatus } from '@/state/state';

/**
 * Criteria used to validate if the current application context matches the expected state.
 * All provided properties must match for the context to be considered valid.
 */
export interface ContextCriteria {
    /** The expected active Note ID. */
    noteId?: string | null;
    /** The expected active file path. */
    filePath?: string;
    /** The expected view mode (versions vs edits). */
    viewMode?: ViewMode;
    /** The expected active branch name. */
    branch?: string;
    /** The expected application status. */
    status?: AppStatus;
    /** 
     * The expected context version. 
     * This is the strongest guard against race conditions. 
     */
    contextVersion?: number;
}

/**
 * Checks if the plugin is currently unloading.
 * Used to prevent operations from continuing during plugin teardown.
 * 
 * @param services - The service registry containing the plugin instance.
 * @returns True if the plugin is unloading, false otherwise.
 */
export const isPluginUnloading = (services: Services): boolean => {
    try {
        return services.plugin?.isUnloading === true;
    } catch {
        return true; // Fail safe
    }
};

/**
 * Validates that the current Redux state matches the provided criteria.
 * This is the primary mechanism for detecting race conditions in async thunks.
 * 
 * @param getState - Redux getState function (returns RootState).
 * @param criteria - The criteria to match against the current state.
 * @returns True if the context is valid (matches criteria), false otherwise.
 */
export const isContextValid = (
    getState: () => RootState,
    criteria: ContextCriteria
): boolean => {
    const rootState = getState();
    const state = rootState.app;

    if (criteria.contextVersion !== undefined && state.contextVersion !== criteria.contextVersion) return false;
    if (criteria.status !== undefined && state.status !== criteria.status) return false;
    if (criteria.noteId !== undefined && state.noteId !== criteria.noteId) return false;
    if (criteria.filePath !== undefined && state.file?.path !== criteria.filePath) return false;
    if (criteria.viewMode !== undefined && state.viewMode !== criteria.viewMode) return false;
    if (criteria.branch !== undefined && state.currentBranch !== criteria.branch) return false;

    return true;
};

/**
 * Comprehensive guard that checks if execution should be aborted.
 * Aborts if:
 * 1. The plugin is unloading.
 * 2. The current state does not match the provided context criteria (if any).
 * 
 * @param services - Service registry.
 * @param getState - Redux getState function (returns RootState).
 * @param criteria - Optional context criteria to validate against.
 * @returns True if execution should be aborted, false if it is safe to proceed.
 */
export const shouldAbort = (
    services: Services,
    getState: () => RootState,
    criteria?: ContextCriteria
): boolean => {
    if (isPluginUnloading(services)) return true;
    if (criteria && !isContextValid(getState, criteria)) return true;
    return false;
};
