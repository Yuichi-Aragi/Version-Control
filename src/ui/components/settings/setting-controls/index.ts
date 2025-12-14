/**
 * Setting Controls Module
 *
 * This module provides specific setting control implementations for the plugin.
 * Each control handles a particular setting or group of related settings.
 *
 * @module ui/components/settings/setting-controls
 *
 * ## Components
 *
 * ### Setting Groups
 * - **AutoCleanupSettings**: Auto-cleanup configuration controls
 * - **AutoRegisterSettings**: Auto-register new notes controls
 * - **AutoSaveSettings**: Auto-save configuration controls
 * - **WatchModeSettings**: Watch mode interval controls
 *
 * ### Individual Controls
 * - **IsGlobalSetting**: Global/local settings toggle
 * - **MaxVersionsSetting**: Maximum versions slider
 * - **MinLinesControl**: Minimum lines threshold control
 * - **NoteSettingsControls**: Note-specific settings container
 *
 * ### Text Statistics
 * - **WordCountSettings**: Word count threshold setting
 * - **CharacterCountSettings**: Character count threshold setting
 * - **LineCountSettings**: Line count threshold setting
 *
 * ### Toggle Settings (Factory-created)
 * - **EnableNamingSetting**: Enable version naming toggle
 * - **EnableDescriptionSetting**: Enable description toggle
 * - **ShowDescriptionInListSetting**: Show description in list toggle
 * - **ListViewSetting**: List view mode toggle
 * - **RelativeTimestampSetting**: Relative timestamp toggle
 * - **RenderMarkdownSetting**: Render markdown toggle
 *
 * ## Factories
 *
 * - **createToggleSliderSetting**: Creates toggle with slider setting
 * - **createToggleSliderWithMinLinesSetting**: Creates toggle with slider and min lines
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   AutoSaveSettings,
 *   MaxVersionsSetting,
 *   WatchModeSettings
 * } from '@/ui/components/settings/setting-controls';
 * ```
 */

// ============================================================================
// SETTING GROUP COMPONENTS
// ============================================================================

export { AutoCleanupSettings } from './AutoCleanupSettings';
export { AutoRegisterSettings } from './AutoRegisterSettings';
export { AutoSaveSettings } from './AutoSaveSettings';
export { WatchModeSettings } from './WatchModeSettings';

// ============================================================================
// INDIVIDUAL SETTING CONTROLS
// ============================================================================

export { IsGlobalSetting } from './IsGlobalSetting';
export { MaxVersionsSetting } from './MaxVersionsSetting';
export { MinLinesControl } from './MinLinesControl';
export { NoteSettingsControls } from './NoteSettingsControls';

// ============================================================================
// TEXT STATISTICS SETTINGS
// ============================================================================

export { WordCountSettings, CharacterCountSettings, LineCountSettings } from './TextStatSettings';

// ============================================================================
// FACTORY-CREATED TOGGLE SETTINGS
// ============================================================================

export {
    EnableNamingSetting,
    EnableDescriptionSetting,
    ShowDescriptionInListSetting,
    ListViewSetting,
    RelativeTimestampSetting,
    RenderMarkdownSetting
} from './ToggleSettingFactory';

// ============================================================================
// SETTING FACTORIES
// ============================================================================

export { createToggleSliderSetting } from './ToggleSliderFactory';
export { createToggleSliderWithMinLinesSetting } from './ToggleSliderWithMinLinesFactory';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { HistorySettings } from '@/types';

/**
 * Props for setting components that modify HistorySettings.
 */
export interface HistorySettingProps {
    settings: HistorySettings;
    onChange: (key: keyof HistorySettings, value: HistorySettings[keyof HistorySettings]) => void;
    disabled?: boolean;
}

/**
 * Configuration for toggle-slider settings.
 */
export interface ToggleSliderConfig {
    toggleKey: keyof HistorySettings;
    sliderKey: keyof HistorySettings;
    label: string;
    description: string;
    min: number;
    max: number;
    step?: number;
}
