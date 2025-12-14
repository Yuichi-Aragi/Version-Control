/**
 * Redux Thunks Module
 *
 * This module aggregates all async thunks from modularized files into a single
 * `thunks` object. This maintains a consistent external API while allowing for
 * better internal organization.
 *
 * @module state/thunks
 *
 * ## Thunk Categories
 *
 * - **core**: Core application thunks (initialization, note loading)
 * - **version**: Version CRUD operations (save, delete, restore)
 * - **ui**: UI-related thunks (panel toggling, notifications)
 * - **diff**: Diff computation thunks
 * - **settings**: Settings management thunks
 * - **timeline**: Timeline generation thunks
 * - **editHistory**: Edit history thunks
 * - **event**: Event-related thunks
 *
 * ## Usage
 *
 * ```typescript
 * import { thunks } from '@/state/thunks';
 *
 * // Dispatch thunks
 * dispatch(thunks.saveNewVersion({ isAuto: false }));
 * dispatch(thunks.loadNoteData(noteId));
 * dispatch(thunks.computeDiff({ version1Id, version2Id }));
 * ```
 */

// ============================================================================
// THUNK IMPORTS
// ============================================================================

import * as core from './core.thunks';
import * as version from './version';
import * as ui from './ui.thunks';
import * as diff from './diff.thunks';
import * as settings from './settings';
import * as timeline from './timeline.thunks';
import * as editHistory from './edit-history';
import * as event from './event.thunks';

// ============================================================================
// AGGREGATED THUNKS EXPORT
// ============================================================================

/**
 * Aggregates all thunks from modularized files into a single `thunks` object.
 * This maintains a consistent external API for dispatching thunks while allowing
 * for better internal organization.
 */
export const thunks = {
    ...core,
    ...version,
    ...ui,
    ...diff,
    ...settings,
    ...timeline,
    ...editHistory,
    ...event,
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Type representing all available thunks.
 */
export type Thunks = typeof thunks;

/**
 * Union type of all thunk action names.
 */
export type ThunkName = keyof Thunks;
