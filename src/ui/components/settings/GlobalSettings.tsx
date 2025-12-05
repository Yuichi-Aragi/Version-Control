import { memo, useCallback, useEffect, useMemo } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { debounce } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { thunks } from '../../../state/thunks';
import { SettingComponent } from '../SettingComponent';
import { ValidatedInput, ValidatedTextarea } from './controls/ValidatedControls';
import { 
    DatabasePathSchema, 
    FrontmatterKeySchema,
    RegexListSchema 
} from './settingsUtils';
import { z } from 'zod';

// --- Database Path Setting ---

const DatabasePathFormSchema = z.object({
    databasePath: DatabasePathSchema
});

type DatabasePathFormValues = z.infer<typeof DatabasePathFormSchema>;

const DatabasePathSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const databasePath = useAppSelector(state => state.settings.databasePath);

    const { control, handleSubmit, reset, formState: { isValid, isDirty } } = useForm<DatabasePathFormValues>({
        mode: 'onChange',
        resolver: zodResolver(DatabasePathFormSchema),
        defaultValues: { databasePath }
    });

    // Sync external state changes
    useEffect(() => {
        reset({ databasePath });
    }, [databasePath, reset]);

    const onSubmit: SubmitHandler<DatabasePathFormValues> = (data) => {
        if (data.databasePath !== databasePath) {
            dispatch(thunks.renameDatabasePath(data.databasePath));
        }
    };

    return (
        <SettingComponent 
            name="Database path" 
            desc={`The vault-relative path for the version history database. Current: ${databasePath}`}
        >
            <form onSubmit={handleSubmit(onSubmit)} className="v-setting-form" style={{ width: '100%' }}>
                <ValidatedInput 
                    name="databasePath" 
                    control={control} 
                    placeholder="e.g., .versiondb" 
                    maxLength={255}
                />
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                        type="submit"
                        aria-label="Apply database path change"
                        disabled={!isValid || !isDirty}
                    >
                        Apply
                    </button>
                </div>
            </form>
        </SettingComponent>
    );
});
DatabasePathSetting.displayName = 'DatabasePathSetting';

// --- Key Update Filter Setting ---

const KeyUpdateFilterFormSchema = z.object({
    filters: RegexListSchema
});

type KeyUpdateFilterFormValues = z.infer<typeof KeyUpdateFilterFormSchema>;

const KeyUpdateFilterSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const keyUpdatePathFilters = useAppSelector(state => state.settings.keyUpdatePathFilters);
    
    const { control, watch, reset, formState: { isValid } } = useForm<KeyUpdateFilterFormValues>({
        mode: 'onChange',
        resolver: zodResolver(KeyUpdateFilterFormSchema),
        defaultValues: { filters: keyUpdatePathFilters.join('\n') }
    });

    const debouncedSave = useMemo(() => debounce((value: string) => {
        const filterArray = value.split('\n').map(s => s.trim()).filter(Boolean);
        dispatch(thunks.updateGlobalSettings({ keyUpdatePathFilters: filterArray }));
    }, 1000), [dispatch]);

    // Sync external state changes
    useEffect(() => {
        reset({ filters: keyUpdatePathFilters.join('\n') });
    }, [keyUpdatePathFilters, reset]);

    useEffect(() => {
        const subscription = watch((value) => {
            if (isValid && value.filters !== undefined) {
                debouncedSave(value.filters);
            }
        });
        return () => {
            subscription.unsubscribe();
            debouncedSave.flush(); // Flush pending changes on unmount/cleanup
        };
    }, [watch, isValid, debouncedSave]);

    return (
        <>
            <p className="v-settings-info v-meta-label">
                (Optional) Exclude paths from this key update. Enter one case-sensitive regular expression per line.
            </p>
            <ValidatedTextarea 
                name="filters"
                control={control}
                rows={3}
                placeholder={"^DoNotUpdateThisFolder/.*\n/path/to/specific-file.md"}
                maxLength={1000}
            />
        </>
    );
});
KeyUpdateFilterSetting.displayName = 'KeyUpdateFilterSetting';

// --- Frontmatter Key Setting ---

const FrontmatterKeyFormSchema = z.object({
    key: FrontmatterKeySchema
});

type FrontmatterKeyFormValues = z.infer<typeof FrontmatterKeyFormSchema>;

const FrontmatterKeySetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const frontmatterKey = useAppSelector(state => state.settings.noteIdFrontmatterKey);

    const { control, handleSubmit, reset, formState: { isValid, isDirty } } = useForm<FrontmatterKeyFormValues>({
        mode: 'onChange',
        resolver: zodResolver(FrontmatterKeyFormSchema),
        defaultValues: { key: frontmatterKey }
    });

    useEffect(() => {
        reset({ key: frontmatterKey });
    }, [frontmatterKey, reset]);

    const onSubmit: SubmitHandler<FrontmatterKeyFormValues> = (data) => {
        if (data.key !== frontmatterKey) {
            dispatch(thunks.requestKeyUpdate(data.key));
        }
    };

    return (
        <>
            <SettingComponent
                name="Frontmatter key"
                desc={`The key used in note frontmatter to store the version control ID. Current: ${frontmatterKey}`}
            >
                <form onSubmit={handleSubmit(onSubmit)} className="v-setting-form" style={{ width: '100%' }}>
                    <ValidatedInput
                        name="key"
                        control={control}
                        placeholder="e.g., vc-id"
                        maxLength={50}
                    />
                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            type="submit"
                            aria-label="Apply frontmatter key change"
                            disabled={!isValid || !isDirty}
                        >
                            Apply
                        </button>
                    </div>
                </form>
            </SettingComponent>
            {isDirty && <KeyUpdateFilterSetting />}
        </>
    );
});
FrontmatterKeySetting.displayName = 'FrontmatterKeySetting';

// --- Auto Register Notes Setting ---

const AutoRegisterFormSchema = z.object({
    filters: RegexListSchema
});

type AutoRegisterFormValues = z.infer<typeof AutoRegisterFormSchema>;

const AutoRegisterNotesSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const autoRegisterNotes = useAppSelector(state => state.settings.autoRegisterNotes);
    const pathFilters = useAppSelector(state => state.settings.pathFilters);
    
    const handleAutoRegisterToggle = useCallback((value: boolean) => {
        dispatch(thunks.updateGlobalSettings({ autoRegisterNotes: value }));
    }, [dispatch]);
    
    const { control, watch, reset, formState: { isValid } } = useForm<AutoRegisterFormValues>({
        mode: 'onChange',
        resolver: zodResolver(AutoRegisterFormSchema),
        defaultValues: { filters: pathFilters.join('\n') }
    });

    const debouncedSave = useMemo(() => debounce((value: string) => {
        const filterArray = value.split('\n').map(s => s.trim()).filter(Boolean);
        dispatch(thunks.updateGlobalSettings({ pathFilters: filterArray }));
    }, 1000), [dispatch]);

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
            debouncedSave.flush(); // Flush pending changes on unmount/cleanup
        };
    }, [watch, isValid, debouncedSave]);

    return (
        <>
            <SettingComponent 
                name="Automatically track new notes" 
                desc="When enabled, any opened note not currently under version control will be automatically added and an initial version will be saved."
            >
                <input 
                    type="checkbox" 
                    checked={autoRegisterNotes} 
                    onChange={e => handleAutoRegisterToggle(e.target.checked)}
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
                    />
                </>
            )}
        </>
    );
});
AutoRegisterNotesSetting.displayName = 'AutoRegisterNotesSetting';

interface GlobalSettingsProps {
    showTitle?: boolean;
}

export const GlobalSettings: React.FC<GlobalSettingsProps> = memo(({ showTitle = true }) => (
    <div className="v-settings-section" role="region" aria-labelledby="global-settings-title">
        {showTitle && <h2 id="global-settings-title">Global Plugin Settings</h2>}
        <DatabasePathSetting />
        <FrontmatterKeySetting />
        <AutoRegisterNotesSetting />
    </div>
));
GlobalSettings.displayName = 'GlobalSettings';
