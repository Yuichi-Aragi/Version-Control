/**
 * Edit History Module
 *
 * This module provides all edit history thunks for managing edit snapshots
 * of notes in the version control system.
 *
 * @module state/thunks/edit-history
 *
 * ## Exports
 *
 * - **Thunks**: All edit history async thunks
 * - **Types**: Edit history type definitions
 * - **Helpers**: Utility functions for edit operations
 *
 * ## Usage
 *
 * ```typescript
 * import { saveNewEdit } from '@/state/thunks/edit-history';
 *
 * // Save new edit
 * dispatch(saveNewEdit(false));
 * ```
 */

// Re-export all thunks
export * from './thunks';

// Re-export types
export * from './types';

// Re-export helpers for internal use
export * from './helpers';
