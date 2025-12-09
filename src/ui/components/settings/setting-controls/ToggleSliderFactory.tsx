import { memo, useCallback, type FC } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import type { HistorySettings } from '../../../../types';
import { SettingComponent } from '../../SettingComponent';
import { validateNumber } from '../settingsUtils';
import { SliderWithInputControl } from '../controls/SliderWithInputControl';

type Unit = 'seconds' | 'days' | 'lines';

interface ToggleSliderConfig {
    toggleName: string;
    toggleDesc: string;
    toggleKey: keyof HistorySettings;
    sliderName: string;
    sliderDesc: (currentValue: number) => string;
    sliderKey: keyof HistorySettings;
    min: number;
    max: number;
    step: number;
    unit: Unit;
    placeholder: string;
}

/**
 * Factory function to create toggle+slider setting components.
 */
export const createToggleSliderSetting = (config: ToggleSliderConfig): FC<{ disabled: boolean }> => {
    const Component = memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        
        const { enabled, value } = useAppSelector(state => ({
            enabled: !!state.effectiveSettings[config.toggleKey],
            value: state.effectiveSettings[config.sliderKey] as number,
        }), isEqual);
        
        const handleToggle = useCallback((v: boolean) => {
            dispatch(thunks.updateSettings({ [config.toggleKey]: v } as Partial<HistorySettings>));
        }, [dispatch]);
        
        const handleSliderChange = useCallback((v: number) => {
            try {
                const validatedValue = validateNumber(v, config.min, config.max);
                dispatch(thunks.updateSettings({ [config.sliderKey]: validatedValue } as Partial<HistorySettings>));
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
                )}
            </>
        );
    });
    
    return Component;
};
