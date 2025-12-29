import { memo, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { valibotResolver } from '@hookform/resolvers/valibot';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import { SettingComponent } from '@/ui/components';
import { ValidatedInput } from './controls/ValidatedControls';
import {
    DatabasePathSchema,
    FrontmatterKeySchema,
    NoteIdFormatSchema,
    VersionIdFormatSchema
} from '@/ui/components/settings/utils';
import * as v from 'valibot';
import { AutoRegisterSettings } from './setting-controls/AutoRegisterSettings';
import type { ViewMode } from '@/types';

// --- Database Path Setting ---

const DatabasePathFormSchema = v.object({
    databasePath: DatabasePathSchema
});

type DatabasePathFormValues = v.InferOutput<typeof DatabasePathFormSchema>;

const DatabasePathSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const databasePath = useAppSelector(state => state.app.settings.databasePath);

    const { control, handleSubmit, reset, formState: { isValid, isDirty } } = useForm<DatabasePathFormValues>({
        mode: 'onChange',
        resolver: valibotResolver(DatabasePathFormSchema),
        defaultValues: { databasePath }
    });

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

// --- Frontmatter Key Setting ---

const FrontmatterKeyFormSchema = v.object({
    key: FrontmatterKeySchema
});

type FrontmatterKeyFormValues = v.InferOutput<typeof FrontmatterKeyFormSchema>;

const FrontmatterKeySetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const frontmatterKey = useAppSelector(state => state.app.settings.noteIdFrontmatterKey);

    const { control, handleSubmit, reset, formState: { isValid, isDirty } } = useForm<FrontmatterKeyFormValues>({
        mode: 'onChange',
        resolver: valibotResolver(FrontmatterKeyFormSchema),
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
    );
});
FrontmatterKeySetting.displayName = 'FrontmatterKeySetting';

// --- Compression Setting ---

const CompressionSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const enableCompression = useAppSelector(state => state.app.settings.enableCompression ?? true);

    const handleToggle = (checked: boolean) => {
        dispatch(thunks.updateGlobalSettings({ enableCompression: checked }));
    };

    return (
        <SettingComponent
            name="Enable compression"
            desc="Compress version files using GZIP to save space. Existing files will be migrated automatically when accessed."
        >
            <input
                type="checkbox"
                checked={enableCompression}
                onChange={(e) => handleToggle(e.target.checked)}
                aria-label="Toggle compression"
            />
        </SettingComponent>
    );
});
CompressionSetting.displayName = 'CompressionSetting';

// --- ID Format Settings ---

const IdFormatFormSchema = v.object({
    noteIdFormat: NoteIdFormatSchema,
    versionIdFormat: VersionIdFormatSchema
});

type IdFormatFormValues = v.InferOutput<typeof IdFormatFormSchema>;

const IdFormatSettings: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const noteIdFormat = useAppSelector(state => state.app.settings.noteIdFormat);
    const versionIdFormat = useAppSelector(state => state.app.settings.versionIdFormat);
    
    const { control, handleSubmit, reset, formState: { isValid, isDirty } } = useForm<IdFormatFormValues>({
        mode: 'onChange',
        resolver: valibotResolver(IdFormatFormSchema),
        defaultValues: { noteIdFormat, versionIdFormat }
    });

    useEffect(() => {
        reset({ noteIdFormat, versionIdFormat });
    }, [noteIdFormat, versionIdFormat, reset]);

    const onSubmit: SubmitHandler<IdFormatFormValues> = (data) => {
        dispatch(thunks.requestUpdateIdFormats(data.noteIdFormat, data.versionIdFormat));
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} style={{ width: '100%' }}>
            <SettingComponent
                name="Note ID format"
                desc="Format for generating note IDs. Available variables: {path}, {uuid}, {timestamp}. Default: {uuid}"
            >
                <ValidatedInput
                    name="noteIdFormat"
                    control={control}
                    placeholder="{uuid}"
                    maxLength={100}
                />
            </SettingComponent>
            
            <SettingComponent
                name="Version ID format"
                desc="Format for generating version IDs. Available variables: {timestamp}, {version}, {name}. Default: {timestamp}_{version}"
            >
                <ValidatedInput
                    name="versionIdFormat"
                    control={control}
                    placeholder="{timestamp}_{version}"
                    maxLength={100}
                />
            </SettingComponent>

            {isDirty && (
                <div className="v-settings-action-row" style={{ marginTop: '12px' }}>
                    <button
                        type="submit"
                        aria-label="Apply ID format changes"
                        className="mod-cta"
                        disabled={!isValid}
                    >
                        Apply ID format changes
                    </button>
                </div>
            )}
        </form>
    );
});
IdFormatSettings.displayName = 'IdFormatSettings';

interface GlobalSettingsProps {
    showTitle?: boolean;
    showPluginSettings?: boolean;
    showDefaults?: boolean;
    activeViewMode?: ViewMode;
    headerAction?: React.ReactNode;
}

export const GlobalSettings: React.FC<GlobalSettingsProps> = memo(({ 
    showTitle = true, 
    showPluginSettings = true, 
    showDefaults = true,
    activeViewMode,
    headerAction
}) => {
    return (
        <div className="v-settings-section" role="region" aria-labelledby="global-settings-title">
            {showTitle && (
                <div className="v-settings-section-header-row">
                    <h2 id="global-settings-title">Global plugin settings</h2>
                    {headerAction}
                </div>
            )}
            
            {showPluginSettings && (
                <>
                    <DatabasePathSetting />
                    <FrontmatterKeySetting />
                    <CompressionSetting />
                    <IdFormatSettings />
                </>
            )}
            
            {showDefaults && (
                <>
                    {(!activeViewMode || activeViewMode === 'versions') && (
                        <div style={{marginTop: '20px', borderTop: showPluginSettings ? '1px solid var(--background-modifier-border)' : 'none', paddingTop: '10px'}}>
                            <h3 id="global-version-defaults-title">
                                Global version history defaults
                            </h3>
                            <p className="setting-item-description">
                                These settings apply to all notes using version history unless overridden.
                            </p>
                            <AutoRegisterSettings settingKey="versionHistorySettings" />
                        </div>
                    )}

                    {(!activeViewMode || activeViewMode === 'edits') && (
                        <div style={{marginTop: '20px', borderTop: (showPluginSettings || !activeViewMode) ? '1px solid var(--background-modifier-border)' : 'none', paddingTop: '10px'}}>
                            <h3 id="global-edit-defaults-title">
                                Global edit history defaults
                            </h3>
                            <p className="setting-item-description">
                                These settings apply to all notes using edit history unless overridden.
                            </p>
                            <AutoRegisterSettings settingKey="editHistorySettings" />
                        </div>
                    )}
                </>
            )}
        </div>
    );
});
GlobalSettings.displayName = 'GlobalSettings';
