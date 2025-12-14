import { memo, useCallback, type ChangeEvent } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import { SettingComponent } from '@/ui/components';

export const MaxVersionsSetting: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { maxVersions, viewMode } = useAppSelector(state => ({
        maxVersions: state.effectiveSettings.maxVersionsPerNote,
        viewMode: state.viewMode
    }));
    
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

    const noun = viewMode === 'versions' ? 'versions' : 'edits';
    const name = `Max ${noun} per note`;
    const desc = `Maximum number of ${noun} to keep per note. Oldest ${noun} are deleted first. Set to 0 for infinite. Current: ${maxVersions === 0 ? "infinite" : maxVersions}`;

    return (
        <SettingComponent 
            name={name} 
            desc={desc}
        >
            <input 
                type="number" 
                min={0} 
                max={1000}
                value={String(maxVersions)} 
                onChange={handleChange} 
                disabled={disabled}
                aria-label={name}
            />
        </SettingComponent>
    );
});
MaxVersionsSetting.displayName = 'MaxVersionsSetting';
