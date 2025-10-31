import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';
import { validateNumber, formatInterval } from '../settingsUtils';
import { MinLinesControl } from './MinLinesControl';
import { SliderWithInputControl } from '../controls/SliderWithInputControl';

export const WatchModeSettings: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { enabled, interval } = useAppSelector(state => ({
        enabled: state.settings.enableWatchMode,
        interval: state.settings.watchModeInterval,
    }), isEqual);
    
    const handleToggle = useCallback((v: boolean) => {
        dispatch(thunks.updateSettings({ enableWatchMode: v }));
    }, [dispatch]);
    
    const handleSliderChange = useCallback((v: number) => {
        try {
            const validatedValue = validateNumber(v, 5, 300);
            dispatch(thunks.updateSettings({ watchModeInterval: validatedValue }));
        } catch (error) {
            console.error('Invalid watch mode interval:', error);
        }
    }, [dispatch]);
    
    return (
        <>
            <SettingComponent 
                name="Enable watch mode" 
                desc="Automatically save a new version if the note has changed after a set interval."
            >
                <input 
                    type="checkbox" 
                    checked={enabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label="Toggle watch mode"
                />
            </SettingComponent>
            {enabled && (
                <>
                    <SettingComponent 
                        name="Watch mode interval" 
                        desc={`Time to wait before auto-saving. Current: ${formatInterval(interval)}.`}
                    >
                        <SliderWithInputControl
                            min={5} 
                            max={300} 
                            step={5} 
                            value={interval} 
                            onFinalChange={handleSliderChange} 
                            disabled={disabled} 
                            unit="seconds"
                            placeholder="e.g., 1:30 or 90"
                        />
                    </SettingComponent>
                    <MinLinesControl disabled={disabled} />
                </>
            )}
        </>
    );
});
WatchModeSettings.displayName = 'WatchModeSettings';
