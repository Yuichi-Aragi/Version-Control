/**
 * Setup Module
 *
 * This module provides plugin initialization and setup utilities.
 * It handles event listener registration, view registration, and UI setup.
 *
 * @module setup
 *
 * ## Components
 *
 * - **EventSetup**: Registers system event listeners for file operations
 * - **UISetup**: Registers views, ribbon icons, and commands
 *
 * ## Usage
 *
 * ```typescript
 * import { registerSystemEventListeners, registerViews } from '@/setup';
 *
 * // During plugin load
 * registerSystemEventListeners(plugin);
 * registerViews(plugin);
 * addRibbonIcon(plugin);
 * registerCommands(plugin);
 * ```
 */

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

export { registerSystemEventListeners } from './EventSetup';
export { registerViews, addRibbonIcon, registerCommands } from './UISetup';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type VersionControlPlugin from '@/main';

/**
 * Function signature for event listener registration.
 */
export type EventSetupFn = (plugin: VersionControlPlugin) => void;

/**
 * Function signature for UI setup operations.
 */
export type UISetupFn = (plugin: VersionControlPlugin) => void;
