import { formatInterval } from '@/ui/components/settings/utils';
import { createToggleSliderWithMinLinesSetting } from './ToggleSliderWithMinLinesFactory';

export const WatchModeSettings = createToggleSliderWithMinLinesSetting({
    toggleName: 'Enable watch mode',
    toggleDesc: (mode) => `Automatically save a new ${mode === 'versions' ? 'version' : 'edit'} if the note has changed after a set interval.`,
    toggleKey: 'enableWatchMode',
    sliderName: 'Watch mode interval',
    sliderDesc: (value) => `Time to wait before auto-saving. Current: ${formatInterval(value)}.`,
    sliderKey: 'watchModeInterval',
    min: 5,
    max: 300,
    step: 5,
    unit: 'seconds',
    placeholder: 'e.g., 1:30 or 90'
});
WatchModeSettings.displayName = 'WatchModeSettings';
