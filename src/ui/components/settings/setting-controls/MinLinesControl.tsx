import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';
import { SliderControl } from '../controls/SliderControl';
import { validateNumber } from '../settingsUtils';

export const MinLinesControl: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { enabled, value } = useAppSelector(state => ({
        enabled: state.settings.enableMinLinesChangedCheck,
        value: state.settings.minLinesChanged,
    }), isEqual);
    
    const handleToggle = useCallback((v: boolean) => {
        dispatch(thunks.updateSettings({ enableMinLinesChangedCheck: v }));
    }, [dispatch]);
    
    const handleSliderChange = useCallback((v: number) => {
        try {
            const validatedValue = validateNumber(v, 1, 50);
            dispatch(thunks.updateSettings({ minLinesChanged: validatedValue }));
        } catch (error) {
            console.error('Invalid min lines value:', error);
        }
    }, [dispatch]);

    return (
        <>
            <SettingComponent 
                name="Only save if lines changed" 
                desc="If enabled, auto-save will only trigger if a minimum number of lines have changed."
            >
                <input 
                    type="checkbox" 
                    checked={enabled} 
                    onChange={e => handleToggle(e.target.checked)} 
                    disabled={disabled}
                    aria-label="Toggle minimum lines check"
                />
            </SettingComponent>
            {enabled && (
                <SettingComponent 
                    name="Minimum lines changed" 
                    desc={`The total number of added/removed lines required to trigger an auto-save. Current: ${value}.`}
                >
                    <SliderControl 
                        min={1} 
                        max={50} 
                        step={1} 
                        value={value} 
                        onFinalChange={handleSliderChange} 
                        disabled={disabled} 
                    />
                </SettingComponent>
            )}
        </>
    );
});
MinLinesControl.displayName = 'MinLinesControl';
