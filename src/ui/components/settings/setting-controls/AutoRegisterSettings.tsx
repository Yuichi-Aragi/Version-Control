import { memo, useCallback, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { debounce } from 'lodash-es';
import { z } from 'zod';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import { SettingComponent } from '../../SettingComponent';
import { ValidatedTextarea } from '../controls/ValidatedControls';
import { RegexListSchema } from '../settingsUtils';


const AutoRegisterFormSchema = z.object({
    filters: RegexListSchema
});

type AutoRegisterFormValues = z.infer<typeof AutoRegisterFormSchema>;

interface AutoRegisterSettingsProps {
    settingKey: 'versionHistorySettings' | 'editHistorySettings';
    disabled?: boolean;
}

export const AutoRegisterSettings: React.FC<AutoRegisterSettingsProps> = memo(({ settingKey, disabled }) => {
    const dispatch = useAppDispatch();
    
    // We read from the global settings directly since this is a global config
    const settings = useAppSelector(state => state.settings[settingKey]);
    const autoRegisterNotes = settings.autoRegisterNotes;
    const pathFilters = settings.pathFilters;

    const handleAutoRegisterToggle = useCallback((value: boolean) => {
        dispatch(thunks.updateGlobalSettings({ 
            [settingKey]: { ...settings, autoRegisterNotes: value } 
        }));
    }, [dispatch, settingKey, settings]);

    const { control, watch, reset, formState: { isValid } } = useForm<AutoRegisterFormValues>({
        mode: 'onChange',
        resolver: zodResolver(AutoRegisterFormSchema),
        defaultValues: { filters: pathFilters.join('\n') }
    });

    const debouncedSave = useMemo(() => debounce((value: string) => {
        const filterArray = value.split('\n').map(s => s.trim()).filter(Boolean);
        dispatch(thunks.updateGlobalSettings({ 
            [settingKey]: { ...settings, pathFilters: filterArray } 
        }));
    }, 1000), [dispatch, settingKey, settings]);

    // Sync external state changes
    useEffect(() => {
        reset({ filters: pathFilters.join('\n') });
    }, [pathFilters, reset]);

    useEffect(() => {
        const subscription = watch((value) => {
            if (isValid && value.filters !== undefined) {
                debouncedSave(value.filters);
            }
        });
        return () => {
            subscription.unsubscribe();
            debouncedSave.flush();
        };
    }, [watch, isValid, debouncedSave]);

    return (
        <>
            <SettingComponent 
                name="Automatically track new notes" 
                desc="When enabled, any opened note not currently under version control will be automatically added."
            >
                <input 
                    type="checkbox" 
                    checked={autoRegisterNotes} 
                    onChange={e => handleAutoRegisterToggle(e.target.checked)}
                    disabled={disabled}
                    aria-label="Toggle automatic note tracking"
                />
            </SettingComponent>
            {autoRegisterNotes && (
                <>
                    <p className="v-settings-info v-meta-label">
                        Enter one case-sensitive regular expression per line. Notes with paths matching any of these patterns will be excluded from auto-tracking.
                    </p>
                    <ValidatedTextarea 
                        name="filters"
                        control={control}
                        rows={3}
                        placeholder={"^Private/.*\n_templates/.*"}
                        maxLength={1000}
                        disabled={disabled ?? false}
                    />
                </>
            )}
        </>
    );
});
AutoRegisterSettings.displayName = 'AutoRegisterSettings';
