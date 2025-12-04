import { memo, useCallback, type FC } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import type { VersionControlSettings } from '../../../../types';
import { SettingComponent } from '../../SettingComponent';
import { validateNumber } from '../settingsUtils';
import { SliderWithInputControl } from '../controls/SliderWithInputControl';
import { MinLinesControl } from './MinLinesControl';

type Unit = 'seconds' | 'days' | 'lines';

interface ToggleSliderWithMinLinesConfig {
    toggleName: string;
    toggleDesc: string;
    toggleKey: keyof VersionControlSettings;
    sliderName: string;
    sliderDesc: (currentValue: number) => string;
    sliderKey: keyof VersionControlSettings;
    min: number;
    max: number;
    step: number;
    unit: Unit;
    placeholder: string;
}

/**
 * Factory for creating a setting group: Toggle -> (Slider + MinLinesControl).
 * Used for AutoSave and WatchMode settings.
 */
export const createToggleSliderWithMinLinesSetting = (config: ToggleSliderWithMinLinesConfig): FC<{ disabled: boolean }> => {
    const Component = memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        
        const { enabled, value } = useAppSelector(state => ({
            enabled: !!state.settings[config.toggleKey],
            value: state.settings[config.sliderKey] as number,
        }), isEqual);
        
        const handleToggle = useCallback((v: boolean) => {
            dispatch(thunks.updateSettings({ [config.toggleKey]: v } as Partial<VersionControlSettings>));
        }, [dispatch]);
        
        const handleSliderChange = useCallback((v: number) => {
            try {
                const validatedValue = validateNumber(v, config.min, config.max);
                dispatch(thunks.updateSettings({ [config.sliderKey]: validatedValue } as Partial<VersionControlSettings>));
            } catch (error) {
                console.error(`Invalid ${config.sliderName.toLowerCase()} value:`, error);
            }
        }, [dispatch]);
        
        return (
            <>
                <SettingComponent name={config.toggleName} desc={config.toggleDesc}>
                    <input 
                        type="checkbox" 
                        checked={enabled} 
                        onChange={e => handleToggle(e.target.checked)} 
                        disabled={disabled}
                        aria-label={`Toggle ${config.toggleName.toLowerCase()}`}
                    />
                </SettingComponent>
                {enabled && (
                    <>
                        <SettingComponent 
                            name={config.sliderName} 
                            desc={config.sliderDesc(value)}
                        >
                            <SliderWithInputControl
                                min={config.min} 
                                max={config.max} 
                                step={config.step} 
                                value={value} 
                                onFinalChange={handleSliderChange} 
                                disabled={disabled} 
                                unit={config.unit}
                                placeholder={config.placeholder}
                            />
                        </SettingComponent>
                        <MinLinesControl disabled={disabled} />
                    </>
                )}
            </>
        );
    });
    
    Component.displayName = `ToggleSliderWithMinLines(${config.toggleKey})`;
    return Component;
};
