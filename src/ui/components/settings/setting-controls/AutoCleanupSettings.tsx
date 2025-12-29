import { createToggleSliderSetting } from './ToggleSliderFactory';

/**
 * Auto-cleanup settings using the shared factory to eliminate duplication.
 */
export const AutoCleanupSettings = createToggleSliderSetting({
    toggleName: (mode) => `Auto-cleanup old ${mode === 'versions' ? 'versions' : 'edits'} by age`,
    toggleDesc: (mode) => `Automatically delete ${mode === 'versions' ? 'versions' : 'edits'} older than a specified number of days. Keeps at least one ${mode === 'versions' ? 'version' : 'edit'}.`,
    toggleKey: 'autoCleanupOldVersions',
    sliderName: (mode) => `Delete ${mode === 'versions' ? 'versions' : 'edits'} older than (days)`,
    sliderDesc: (days) => `Applies if "auto-cleanup by age" is on. Min 7, max 365. Current: ${days} days.`,
    sliderKey: 'autoCleanupDays',
    min: 7,
    max: 365,
    step: 1,
    unit: 'days',
    placeholder: 'e.g., 30'
});
AutoCleanupSettings.displayName = 'AutoCleanupSettings';