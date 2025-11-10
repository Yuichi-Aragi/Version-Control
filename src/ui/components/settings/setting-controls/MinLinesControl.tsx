import { createToggleSliderSetting } from './ToggleSliderFactory';

/**
 * Minimum lines changed control using the shared factory to eliminate duplication.
 */
export const MinLinesControl = createToggleSliderSetting({
    toggleName: 'Only save if lines changed',
    toggleDesc: 'If enabled, auto-save will only trigger if a minimum number of lines have changed.',
    toggleKey: 'enableMinLinesChangedCheck',
    sliderName: 'Minimum lines changed',
    sliderDesc: (value) => `The total number of added/removed lines required to trigger an auto-save. Current: ${value}.`,
    sliderKey: 'minLinesChanged',
    min: 1,
    max: 50,
    step: 1,
    unit: 'lines',
    placeholder: 'e.g., 5'
});
MinLinesControl.displayName = 'MinLinesControl';
