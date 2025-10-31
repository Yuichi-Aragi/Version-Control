import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';
import { validateNumber } from '../settingsUtils';
import { SliderWithInputControl } from '../controls/SliderWithInputControl';

export const AutoCleanupSettings: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { enabled, days } = useAppSelector(state => ({
        enabled: state.settings.autoCleanupOldVersions,
        days: state.settings.autoCleanupDays,
    }), isEqual);
    
    const handleToggle = useCallback((v: boolean) => {
        dispatch(thunks.updateSettings({ autoCleanupOldVersions: v }));
    }, [dispatch]);
    
    const handleSliderChange = useCallback((v: number) => {
        try {
            const validatedValue = validateNumber(v, 7, 365);
            dispatch(thunks.updateSettings({ autoCleanupDays: validatedValue }));
        } catch (error) {
            console.error('Invalid cleanup days value:', error);
        }
    }, [dispatch]);
    
    return (
        <>
            <SettingComponent 
                name="Auto-cleanup old versions by age" 
                desc="Automatically delete versions older than a specified number of days. Keeps at least one version."
            >
                <input 
                    type="checkbox" 
                    checked={enabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label="Toggle auto-cleanup by age"
                />
            </SettingComponent>
            {enabled && (
                <SettingComponent 
                    name="Delete versions older than (days)" 
                    desc={`Applies if "auto-cleanup by age" is on. Min 7, max 365. Current: ${days} days.`}
                >
                    <SliderWithInputControl
                        min={7} 
                        max={365} 
                        step={1} 
                        value={days} 
                        onFinalChange={handleSliderChange} 
                        disabled={disabled} 
                        unit="days"
                        placeholder="e.g., 30"
                    />
                </SettingComponent>
            )}
        </>
    );
});
AutoCleanupSettings.displayName = 'AutoCleanupSettings';
