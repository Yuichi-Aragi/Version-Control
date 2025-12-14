/**
 * UI Module
 *
 * This module provides the React-based user interface for the version control plugin.
 * It exports components, hooks, contexts, utilities, and action configurations.
 *
 * @module ui
 *
 * ## Architecture
 *
 * The UI layer is built with:
 *
 * - **React**: Component-based UI framework
 * - **Redux**: State management via useSelector/useDispatch hooks
 * - **Obsidian Integration**: AppContext for accessing Obsidian's App instance
 *
 * ## Sub-modules
 *
 * - **components**: Reusable UI components (panels, settings, shared)
 * - **hooks**: Custom React hooks for common patterns
 * - **contexts**: React contexts for dependency injection
 * - **utils**: DOM and string utilities
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   VersionControlRoot,
 *   useApp,
 *   useAppSelector,
 *   versionActions
 * } from '@/ui';
 *
 * // Root component for the sidebar view
 * <VersionControlRoot plugin={plugin} />
 * ```
 */

// ============================================================================
// SUB-MODULE RE-EXPORTS
// ============================================================================

export * from './components';
export * from './hooks';
export * from './contexts';
export * from './utils';

// ============================================================================
// APP CONTEXT
// ============================================================================

export { AppContext, useApp } from './AppContext';

// ============================================================================
// ACTION CONFIGURATIONS
// ============================================================================

export { editActions } from './EditActions';
export { versionActions } from './VersionActions';
export type { VersionActionConfig } from './VersionActions';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { App } from 'obsidian';
import type VersionControlPlugin from '@/main';

/**
 * Props for the root UI component.
 */
export interface VersionControlRootProps {
    plugin: VersionControlPlugin;
}

/**
 * Context value for Obsidian App access.
 */
export interface AppContextValue {
    app: App;
}
