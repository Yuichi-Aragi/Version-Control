import { createToggleSliderSetting } from './ToggleSliderFactory';

/**
 * Auto-cleanup settings using the shared factory to eliminate duplication.
 */
export const AutoCleanupSettings = createToggleSliderSetting({
    toggleName: 'Auto-cleanup old versions by age',
    toggleDesc: 'Automatically delete versions older than a specified number of days. Keeps at least one version.',
    toggleKey: 'autoCleanupOldVersions',
    sliderName: 'Delete versions older than (days)',
    sliderDesc: (days) => `Applies if "auto-cleanup by age" is on. Min 7, max 365. Current: ${days} days.`,
    sliderKey: 'autoCleanupDays',
    min: 7,
    max: 365,
    step: 1,
    unit: 'days',
    placeholder: 'e.g., 30'
});
AutoCleanupSettings.displayName = 'AutoCleanupSettings';
