/**
 * Edit History Thunk Types
 *
 * Type definitions for edit history thunk operations
 */

/**
 * Details for updating an edit's metadata
 */
export interface EditDetails {
    name: string;
    description: string;
}

/**
 * Result of manifest sync operation
 */
export interface ManifestSyncResult {
    dirty: boolean;
    activeBranch: string;
}
