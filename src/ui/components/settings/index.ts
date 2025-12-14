/**
 * Settings Components Module
 *
 * This module provides settings-related components for the version control plugin.
 * Includes both UI components and input controls.
 *
 * @module ui/components/settings
 *
 * ## Components
 *
 * - **GlobalSettings**: Global plugin settings panel
 * - **NoteSpecificSettings**: Per-note settings override panel
 * - **SettingsAction**: Settings action button component
 * - **SettingsTabRoot**: Root component for Obsidian settings tab
 *
 * ## Sub-modules
 *
 * - **controls**: Input control components (sliders, textareas, validated inputs)
 * - **setting-controls**: Specific setting control implementations
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   GlobalSettings,
 *   NoteSpecificSettings,
 *   SettingsTabRoot
 * } from '@/ui/components/settings';
 * ```
 */

// ============================================================================
// SETTINGS COMPONENTS
// ============================================================================

export { GlobalSettings } from './GlobalSettings';
export { NoteSpecificSettings } from './NoteSpecificSettings';
export { SettingsAction } from './SettingsAction';
export { SettingsTabRoot } from './SettingsTabRoot';

// ============================================================================
// SUB-MODULE RE-EXPORTS
// ============================================================================

export * from './controls';
export * from './setting-controls';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { HistorySettings } from '@/types';

/**
 * Props for settings panel components.
 */
export interface SettingsPanelProps {
    settings: HistorySettings;
    onChange: (updates: Partial<HistorySettings>) => void;
    isGlobal: boolean;
}

/**
 * Props for individual setting components.
 */
export interface SettingControlProps<T> {
    value: T;
    onChange: (value: T) => void;
    disabled?: boolean;
    label?: string;
    description?: string;
}
