/**
 * Panel Components Module
 *
 * This module provides expandable panel components for the version control UI.
 * Panels display detailed information like diffs, timelines, and actions.
 *
 * @module ui/components/panels
 *
 * ## Components
 *
 * - **ActionPanel**: Panel with action buttons for version operations
 * - **ChangelogPanel**: Displays version changelog/description
 * - **ConfirmationPanel**: Confirmation dialog panel
 * - **DiffPanel**: Inline diff display panel
 * - **DiffWindow**: Full-window diff viewer
 * - **PanelContainer**: Base container for panels with animations
 * - **PreviewPanel**: Content preview panel
 * - **TimelinePanel**: Visual timeline of version changes
 * - **DashboardPanel**: Dashboard with heatmap statistics
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   DiffPanel,
 *   TimelinePanel,
 *   PanelContainer
 * } from '@/ui/components/panels';
 * ```
 */

// ============================================================================
// PANEL COMPONENTS
// ============================================================================

export { ActionPanel } from './ActionPanel';
export { ChangelogPanel } from './ChangelogPanel';
export { ConfirmationPanel } from './ConfirmationPanel';
export { DiffPanel } from './DiffPanel';
export { DiffWindow } from './DiffWindow';
export { PanelContainer } from './PanelContainer';
export { PreviewPanel } from './PreviewPanel';
export { TimelinePanel } from './TimelinePanel';
export { DashboardPanel } from './DashboardPanel';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { Change, TimelineEvent } from '@/types';

/**
 * Props for diff-related panels.
 */
export interface DiffPanelProps {
    changes: Change[];
    isLoading: boolean;
    onClose: () => void;
}

/**
 * Props for timeline panel.
 */
export interface TimelinePanelProps {
    events: TimelineEvent[];
    isLoading: boolean;
    onEventSelect: (event: TimelineEvent) => void;
}

/**
 * Props for confirmation panel.
 */
export interface ConfirmationPanelProps {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    isDestructive?: boolean;
}
