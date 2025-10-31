import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';
import { validateNumber, formatInterval } from '../settingsUtils';
import { MinLinesControl } from './MinLinesControl';
import { SliderWithInputControl } from '../controls/SliderWithInputControl';

export const AutoSaveSettings: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { enabled, interval } = useAppSelector(state => ({
        enabled: state.settings.autoSaveOnSave,
        interval: state.settings.autoSaveOnSaveInterval,
    }), isEqual);
    
    const handleToggle = useCallback((v: boolean) => {
        dispatch(thunks.updateSettings({ autoSaveOnSave: v }));
    }, [dispatch]);
    
    const handleSliderChange = useCallback((v: number) => {
        try {
            const validatedValue = validateNumber(v, 1, 300);
            dispatch(thunks.updateSettings({ autoSaveOnSaveInterval: validatedValue }));
        } catch (error) {
            console.error('Invalid auto-save interval:', error);
        }
    }, [dispatch]);
    
    return (
        <>
            <SettingComponent 
                name="Auto-save on file save" 
                desc="Automatically save a new version whenever the note file is saved (e.g., via ctrl+s)."
            >
                <input 
                    type="checkbox" 
                    checked={enabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label="Toggle auto-save on file save"
                />
            </SettingComponent>
            {enabled && (
                <>
                    <SettingComponent 
                        name="Auto-save delay" 
                        desc={`Time to wait after last change before auto-saving. Current: ${formatInterval(interval)}.`}
                    >
                        <SliderWithInputControl
                            min={1} 
                            max={300} 
                            step={1} 
                            value={interval} 
                            onFinalChange={handleSliderChange} 
                            disabled={disabled} 
                            unit="seconds"
                            placeholder="e.g., 2:30 or 150"
                        />
                    </SettingComponent>
                    <MinLinesControl disabled={disabled} />
                </>
            )}
        </>
    );
});
AutoSaveSettings.displayName = 'AutoSaveSettings';
