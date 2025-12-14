/**
 * UI Components Module
 *
 * This module provides React components for the version control UI.
 * Components are organized into main components and sub-modules.
 *
 * @module ui/components
 *
 * ## Main Components
 *
 * - **VersionControlRoot**: Root component for the sidebar view
 * - **ActionBar**: Toolbar with action buttons (save, export, etc.)
 * - **HistoryList**: Virtualized list of version/edit entries
 * - **HistoryEntry**: Individual history entry row
 * - **HistoryListHeader**: Header with view mode toggle and search
 * - **SettingsPanel**: Full settings panel component
 * - **SettingComponent**: Individual setting row component
 * - **ErrorDisplay**: Error state display component
 * - **Placeholder**: Loading/empty state placeholder
 * - **Icon**: Icon wrapper component
 *
 * ## Sub-modules
 *
 * - **panels**: Expandable panel components (diff, timeline, export)
 * - **settings**: Settings-related components
 * - **shared**: Shared/utility components
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   VersionControlRoot,
 *   HistoryList,
 *   ActionBar,
 *   SettingsPanel
 * } from '@/ui/components';
 * ```
 */

// ============================================================================
// MAIN COMPONENTS
// ============================================================================

export { ActionBar } from './ActionBar';
export { ErrorDisplay } from './ErrorDisplay';
export { HistoryEntry } from './HistoryEntry';
export { HistoryList } from './HistoryList';
export { HistoryListHeader } from './HistoryListHeader';
export { Icon } from './Icon';
export { Placeholder } from './Placeholder';
export { SettingComponent } from './SettingComponent';
export { SettingsPanel } from './SettingsPanel';
export { VersionControlRoot } from './VersionControlRoot';

// ============================================================================
// SUB-MODULE RE-EXPORTS
// ============================================================================

export * from './panels';
export * from './settings';
export * from './shared';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { VersionHistoryEntry } from '@/types';

/**
 * Props for history entry components.
 */
export interface HistoryEntryProps {
    entry: VersionHistoryEntry;
    isSelected: boolean;
    onSelect: (entry: VersionHistoryEntry) => void;
}

/**
 * Props for action bar components.
 */
export interface ActionBarProps {
    onSave: () => void;
    onExport: () => void;
    onSettings: () => void;
    isLoading?: boolean;
}
