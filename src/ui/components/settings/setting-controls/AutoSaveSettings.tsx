import { formatInterval } from '@/ui/components/settings/utils';
import { createToggleSliderWithMinLinesSetting } from './ToggleSliderWithMinLinesFactory';

export const AutoSaveSettings = createToggleSliderWithMinLinesSetting({
    toggleName: 'Auto-save on file save',
    toggleDesc: (mode) => `Automatically save a new ${mode === 'versions' ? 'version' : 'edit'} whenever the note file is saved (e.g., via ctrl+s).`,
    toggleKey: 'autoSaveOnSave',
    sliderName: 'Auto-save delay',
    sliderDesc: (value) => `Time to wait after last change before auto-saving. Current: ${formatInterval(value)}.`,
    sliderKey: 'autoSaveOnSaveInterval',
    min: 1,
    max: 300,
    step: 1,
    unit: 'seconds',
    placeholder: 'e.g., 2:30 or 150'
});
AutoSaveSettings.displayName = 'AutoSaveSettings';