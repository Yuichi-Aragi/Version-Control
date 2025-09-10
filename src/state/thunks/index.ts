import * as core from './core.thunks';
import * as version from './version.thunks';
import * as ui from './ui.thunks';
import * as diff from './diff.thunks';
import * as settings from './settings.thunks';

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
};