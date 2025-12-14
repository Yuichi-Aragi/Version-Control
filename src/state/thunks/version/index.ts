/**
 * Version Thunks Module
 *
 * This module contains all version-related async thunks organized into a modular structure.
 * It handles version CRUD operations, branch management, and version UI interactions.
 *
 * @module state/thunks/version
 *
 * ## Exported Thunks
 *
 * ### Version Management
 * - `saveNewVersion` - Saves a new version (manual or auto)
 * - `performAutoSave` - Performs automatic version save
 * - `updateVersionDetails` - Updates version name and description
 *
 * ### Version Restoration
 * - `requestRestore` - Prompts user to confirm version restore
 * - `restoreVersion` - Restores a version to the active file
 *
 * ### Version Deletion
 * - `requestDelete` - Prompts user to confirm version delete
 * - `deleteVersion` - Deletes a single version
 * - `requestDeleteAll` - Prompts user to confirm delete all
 * - `deleteAllVersions` - Deletes all versions in current branch
 *
 * ### Version UI
 * - `requestEditVersion` - Opens version editing form
 * - `viewVersionInPanel` - Views version content in preview panel
 *
 * ### Branch Management
 * - `createBranch` - Creates a new branch
 * - `switchBranch` - Switches to a different branch
 *
 * ## Usage
 *
 * ```typescript
 * import { saveNewVersion, restoreVersion } from '@/state/thunks/version';
 *
 * // Save a version
 * dispatch(saveNewVersion({ isAuto: false }));
 *
 * // Restore a version
 * dispatch(restoreVersion(versionId));
 * ```
 */

// Re-export all thunks
export * from './thunks';

// Re-export types for external use
export type { SaveVersionOptions, UpdateVersionDetailsPayload } from './types';
