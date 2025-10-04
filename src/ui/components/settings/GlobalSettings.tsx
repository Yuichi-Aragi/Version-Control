import { memo, useState, useEffect, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { thunks } from '../../../state/thunks';
import { SettingComponent } from '../SettingComponent';
import { DebouncedTextarea } from './controls/DebouncedTextarea';
import { validateString } from './settingsUtils';

const DatabasePathSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const databasePath = useAppSelector(state => state.settings.databasePath);
    const [dbPath, setDbPath] = useState(() => {
        try {
            return validateString(databasePath, 255);
        } catch (error) {
            console.error('Invalid database path:', error);
            return '.versiondb';
        }
    });
    
    useEffect(() => {
        try {
            const validatedPath = validateString(databasePath, 255);
            setDbPath(validatedPath);
        } catch (error) {
            console.error('Invalid database path from state:', error);
        }
    }, [databasePath]);

    const handleDbPathApply = useCallback(() => {
        try {
            const validatedPath = validateString(dbPath, 255);
            if (validatedPath.trim()) {
                dispatch(thunks.renameDatabasePath(validatedPath));
            }
        } catch (error) {
            console.error('Invalid database path on apply:', error);
            dispatch(thunks.showNotice('Invalid database path', 3000));
        }
    }, [dispatch, dbPath]);

    return (
        <SettingComponent 
            name="Database path" 
            desc={`The vault-relative path for the version history database. Current: ${databasePath}`}
        >
            <input 
                type="text" 
                value={dbPath} 
                placeholder="e.g., .versiondb" 
                onChange={e => setDbPath(e.target.value)}
                maxLength={255}
                aria-label="Database path input"
            />
            <button 
                onClick={handleDbPathApply} 
                aria-label="Apply database path change"
                disabled={!dbPath.trim() || dbPath.trim() === databasePath}
            >
                Apply
            </button>
        </SettingComponent>
    );
});
DatabasePathSetting.displayName = 'DatabasePathSetting';

const KeyUpdateFilterSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const keyUpdatePathFilters = useAppSelector(state => state.settings.keyUpdatePathFilters, isEqual);

    const handleFiltersChange = useCallback((value: string) => {
        try {
            const filterArray = value.split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(pattern => {
                    try {
                        new RegExp(pattern);
                        return true;
                    } catch {
                        console.warn(`Invalid regex pattern: ${pattern}`);
                        return false;
                    }
                });
            dispatch(thunks.updateGlobalSettings({ keyUpdatePathFilters: filterArray }));
        } catch (error) {
            console.error('Error processing key update path filters:', error);
        }
    }, [dispatch]);

    return (
        <>
            <p className="v-settings-info v-meta-label">
                (Optional) Exclude paths from this key update. Enter one case-sensitive regular expression per line. Paths matching any pattern will be skipped.
            </p>
            <DebouncedTextarea 
                initialValue={keyUpdatePathFilters.join('\n')} 
                onFinalChange={handleFiltersChange} 
                rows={3} 
                placeholder={"^DoNotUpdateThisFolder/.*\n/path/to/specific-file.md"}
                maxLength={1000}
            />
        </>
    );
});
KeyUpdateFilterSetting.displayName = 'KeyUpdateFilterSetting';

const FrontmatterKeySetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const frontmatterKey = useAppSelector(state => state.settings.noteIdFrontmatterKey);
    const [key, setKey] = useState(frontmatterKey);

    useEffect(() => {
        setKey(frontmatterKey);
    }, [frontmatterKey]);

    const handleApply = useCallback(() => {
        dispatch(thunks.requestKeyUpdate(key));
    }, [dispatch, key]);

    const isKeyDirty = key.trim() !== '' && key.trim() !== frontmatterKey;

    return (
        <>
            <SettingComponent
                name="Frontmatter key"
                desc={`The key used in note frontmatter to store the version control ID. Current: ${frontmatterKey}`}
            >
                <input
                    type="text"
                    value={key}
                    placeholder="e.g., vc-id"
                    onChange={e => setKey(e.target.value)}
                    maxLength={50}
                    aria-label="Frontmatter key input"
                />
                <button
                    onClick={handleApply}
                    aria-label="Apply frontmatter key change"
                    disabled={!isKeyDirty}
                >
                    Apply
                </button>
            </SettingComponent>
            {isKeyDirty && <KeyUpdateFilterSetting />}
        </>
    );
});
FrontmatterKeySetting.displayName = 'FrontmatterKeySetting';

const AutoRegisterNotesSetting: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const { autoRegisterNotes, pathFilters } = useAppSelector(state => ({
        autoRegisterNotes: state.settings.autoRegisterNotes,
        pathFilters: state.settings.pathFilters,
    }), isEqual);
    
    const handleAutoRegisterToggle = useCallback((value: boolean) => {
        dispatch(thunks.updateGlobalSettings({ autoRegisterNotes: value }));
    }, [dispatch]);
    
    const handleFiltersChange = useCallback((value: string) => {
        try {
            const filterArray = value.split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(pattern => {
                    try {
                        new RegExp(pattern);
                        return true;
                    } catch {
                        console.warn(`Invalid regex pattern: ${pattern}`);
                        return false;
                    }
                });
            dispatch(thunks.updateGlobalSettings({ pathFilters: filterArray }));
        } catch (error) {
            console.error('Error processing path filters:', error);
        }
    }, [dispatch]);

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
                    <DebouncedTextarea 
                        initialValue={pathFilters.join('\n')} 
                        onFinalChange={handleFiltersChange} 
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
