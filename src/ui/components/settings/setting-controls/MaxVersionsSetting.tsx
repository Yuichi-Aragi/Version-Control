import { memo, useCallback, type ChangeEvent } from 'react';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';

export const MaxVersionsSetting: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const maxVersions = useAppSelector(state => state.settings.maxVersionsPerNote);
    
    const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        try {
            const num = parseInt(e.target.value, 10);
            if (!isNaN(num) && num >= 0 && num <= 1000) {
                dispatch(thunks.updateSettings({ maxVersionsPerNote: num }));
            }
        } catch (error) {
            console.error('Invalid max versions value:', error);
        }
    }, [dispatch]);

    return (
        <SettingComponent 
            name="Max versions per note" 
            desc={`Maximum number of versions to keep per note. Oldest versions are deleted first. Set to 0 for infinite. Current: ${maxVersions === 0 ? "infinite" : maxVersions}`}
        >
            <input 
                type="number" 
                min={0} 
                max={1000}
                value={String(maxVersions)} 
                onChange={handleChange} 
                disabled={disabled}
                aria-label="Maximum versions per note"
            />
        </SettingComponent>
    );
});
MaxVersionsSetting.displayName = 'MaxVersionsSetting';
