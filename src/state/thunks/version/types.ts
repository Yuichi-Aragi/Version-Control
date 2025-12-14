import type { VersionControlSettings } from '@/types';

/**
 * Type definitions for version thunk payloads and related interfaces.
 */

/**
 * Options for saving a new version.
 */
export interface SaveVersionOptions {
    /**
     * Whether this is an automatic save.
     */
    isAuto?: boolean;

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
