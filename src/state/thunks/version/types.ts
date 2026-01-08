import type { VersionControlSettings, SaveVersionResult } from '@/types';

/**
 * Type definitions for version thunk payloads and related interfaces.
 */

/**
 * Options for saving a new version.
 */
export interface SaveVersionOptions {
    /**
     * Optional name for the version.
     */
    name?: string;

    /**
     * Whether to force save even if content hasn't changed (e.g. for initial version).
     */
    force?: boolean;

    /**
     * Whether this is an automatic save.
     */
    isAuto?: boolean;

    /**
     * Whether this save is allowed to initialize tracking for a note that has no history.
     * Defaults to false if isAuto is true, and true if isAuto is false.
     */
    allowInit?: boolean;

    /**
     * Settings to use for this save operation.
     * If not provided, falls back to effective settings from state.
     */
    settings?: VersionControlSettings;
}

/**
 * Options for updating version details.
 */
export interface UpdateVersionDetailsPayload {
    /**
     * The new name for the version (will be trimmed).
     */
    name: string;

    /**
     * The new description for the version (will be trimmed).
     */
    description: string;
}

export type { SaveVersionResult };
