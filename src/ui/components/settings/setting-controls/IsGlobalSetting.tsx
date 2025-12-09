import { memo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';

export const IsGlobalSetting: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const isGlobal = useAppSelector(state => state.effectiveSettings.isGlobal ?? true);
    const handleToggle = useCallback((val: boolean) => {
        dispatch(thunks.toggleGlobalSettings(val));
    }, [dispatch]);
    
    return (
        <SettingComponent 
            name="Follow global settings" 
            desc="When on, this note uses the global plugin settings. When off, it has its own independent settings."
        >
            <input 
                type="checkbox" 
                checked={isGlobal} 
                onChange={e => handleToggle(e.target.checked)} 
                disabled={disabled}
                aria-label="Toggle global settings"
            />
        </SettingComponent>
    );
});
IsGlobalSetting.displayName = 'IsGlobalSetting';
