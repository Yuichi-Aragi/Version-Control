import clsx from 'clsx';
import { isEqual } from 'lodash-es';
import { type FC, useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';
import type { VersionControlSettings } from '../../types';
import { SettingComponent } from './SettingComponent';

const AUTO_CLOSE_DELAY_MS = 30000;

const formatInterval = (seconds: number): string => {
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds === 0 ? `${minutes} min` : `${minutes} min ${remainingSeconds} sec`;
};

const SettingsAction: FC<{ text: string; icon: string; onClick: () => void; isWarning?: boolean }> = ({ text, icon, onClick, isWarning }) => (
    <button className={clsx('clickable-icon', { 'mod-warning': isWarning })} aria-label={text} onClick={onClick}>
        <Icon name={icon} /> {text}
    </button>
);

const GlobalSettings: FC = memo(() => {
    const dispatch = useAppDispatch();
    const { databasePath, autoRegisterNotes, pathFilters } = useAppSelector(state => ({
        databasePath: state.settings.databasePath,
        autoRegisterNotes: state.settings.autoRegisterNotes,
        pathFilters: state.settings.pathFilters,
    }), isEqual);
    const [dbPath, setDbPath] = useState(databasePath);
    const [filters, setFilters] = useState(pathFilters.join('\n'));
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => setDbPath(databasePath), [databasePath]);
    useEffect(() => setFilters(pathFilters.join('\n')), [pathFilters]);

    const handleDbPathApply = useCallback(() => dispatch(thunks.renameDatabasePath(dbPath)), [dispatch, dbPath]);
    const handleAutoRegisterToggle = useCallback((value: boolean) => dispatch(thunks.updateGlobalSettings({ autoRegisterNotes: value })), [dispatch]);
    
    const debouncedSaveFilters = useMemo(() => 
        (value: string) => {
            const filterArray = value.split('\n').map(s => s.trim()).filter(Boolean);
            dispatch(thunks.updateGlobalSettings({ pathFilters: filterArray }));
        }, 
    [dispatch]);

    useEffect(() => {
        const handler = setTimeout(() => {
            debouncedSaveFilters(filters);
        }, 1000);
        return () => clearTimeout(handler);
    }, [filters, debouncedSaveFilters]);

    const adjustTextareaHeight = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const maxHeight = (textareaRef.current.parentElement?.clientHeight ?? 0) / 2;
            const newHeight = Math.min(textareaRef.current.scrollHeight + 5, maxHeight);
            textareaRef.current.style.height = `${newHeight}px`;
        }
    }, []);

    useEffect(() => {
        if (autoRegisterNotes) {
            adjustTextareaHeight();
        }
    }, [autoRegisterNotes, filters, adjustTextareaHeight]);

    return (
        <div className="v-settings-section">
            <h4 className="v-settings-section-title">Global Plugin Settings</h4>
            <SettingComponent name="Database path" desc={`The vault-relative path for the version history database. Current: ${databasePath}`}>
                <input type="text" value={dbPath} placeholder="e.g., .versiondb" onChange={e => setDbPath(e.target.value)} />
                <button onClick={handleDbPathApply} aria-label="Apply database path change">Apply</button>
            </SettingComponent>
            <SettingComponent name="Automatically track new notes" desc="When enabled, any opened note not currently under version control will be automatically added and an initial version will be saved.">
                <input type="checkbox" checked={autoRegisterNotes} onChange={e => handleAutoRegisterToggle(e.target.checked)} />
            </SettingComponent>
            {autoRegisterNotes && (
                <>
                    <p className="v-settings-info v-meta-label">Enter one case-sensitive regular expression per line. Notes with paths matching any of these patterns will be excluded from auto-tracking.</p>
                    <textarea ref={textareaRef} className="v-settings-textarea" rows={3} placeholder="^Private/.*\n_templates/.*" value={filters} onChange={e => setFilters(e.target.value)} onFocus={adjustTextareaHeight} onInput={adjustTextareaHeight} />
                </>
            )}
        </div>
    );
});
GlobalSettings.displayName = 'GlobalSettings';

const MinLinesControl: FC<{ settings: VersionControlSettings, disabled: boolean }> = ({ settings, disabled }) => {
    const dispatch = useAppDispatch();
    const handleToggle = (value: boolean) => dispatch(thunks.updateSettings({ enableMinLinesChangedCheck: value }));
    const handleSliderChange = (value: number) => dispatch(thunks.updateSettings({ minLinesChanged: value }));

    return (
        <>
            <SettingComponent name="Only save if lines changed" desc="If enabled, auto-save will only trigger if a minimum number of lines have changed.">
                <input type="checkbox" checked={settings.enableMinLinesChangedCheck} onChange={e => handleToggle(e.target.checked)} disabled={disabled} />
            </SettingComponent>
            {settings.enableMinLinesChangedCheck && (
                <SettingComponent name="Minimum lines changed" desc={`The total number of added/removed lines required to trigger an auto-save. Current: ${settings.minLinesChanged}.`}>
                    <input type="range" min={1} max={50} step={1} value={settings.minLinesChanged} onChange={e => handleSliderChange(Number(e.target.value))} disabled={disabled} />
                </SettingComponent>
            )}
        </>
    );
};

const NoteSpecificSettings: FC = memo(() => {
    const dispatch = useAppDispatch();
    const { status, file, noteId, history, settings } = useAppSelector(state => ({
        status: state.status,
        file: state.file,
        noteId: state.noteId,
        history: state.history,
        settings: state.settings,
    }), isEqual);

    const handleRefresh = useCallback(() => {
        if (!file) return;
        if (noteId) {
            dispatch(thunks.loadHistoryForNoteId(file, noteId));
        } else {
            dispatch(thunks.loadHistory(file));
        }
        dispatch(thunks.closeSettingsPanelWithNotice("History refreshed.", 1500));
    }, [dispatch, file, noteId]);

    const handleExport = useCallback(() => {
        if (!noteId) {
            dispatch(thunks.showNotice("This note is not under version control yet. Cannot export history.", 3000));
            return;
        }
        dispatch(thunks.requestExportAllVersions());
    }, [dispatch, noteId]);

    const handleDeleteAll = useCallback(() => dispatch(thunks.requestDeleteAll()), [dispatch]);
    const handleViewChangelog = useCallback(() => dispatch(thunks.showChangelogPanel({ forceRefresh: true })), [dispatch]);
    const handleReportIssue = useCallback(() => window.open('https://github.com/Yuichi-Aragi/Version-Control/issues', '_blank'), []);

    const updateSetting = (update: Partial<VersionControlSettings>) => dispatch(thunks.updateSettings(update));

    if (status !== AppStatus.READY || !file) return null;
    const areControlsDisabled = !noteId;

    return (
        <>
            <div className="v-settings-section">
                <h4 className="v-settings-section-title">Actions for "{file.basename}"</h4>
                <div className="v-settings-actions">
                    <SettingsAction text="Refresh history" icon="refresh-cw" onClick={handleRefresh} />
                    <SettingsAction text="Export history" icon="download-cloud" onClick={handleExport} />
                    {noteId && history.length > 0 && <SettingsAction text="Delete all versions" icon="trash-2" onClick={handleDeleteAll} isWarning />}
                    <SettingsAction text="View Changelog" icon="file-text" onClick={handleViewChangelog} />
                    <SettingsAction text="Report Issue" icon="bug" onClick={handleReportIssue} />
                </div>
            </div>
            <div className="v-settings-section">
                <h4 className="v-settings-section-title">{noteId ? 'Note-specific settings' : 'Default settings'}</h4>
                {noteId && (
                    <SettingComponent name="Follow global settings" desc="When on, this note uses the global plugin settings. When off, it has its own independent settings.">
                        <input type="checkbox" checked={settings.isGlobal ?? true} onChange={e => dispatch(thunks.toggleGlobalSettings(e.target.checked))} />
                    </SettingComponent>
                )}
                <p className="v-settings-info v-meta-label">
                    {noteId ? (settings.isGlobal ? 'This note follows the global settings. Changes made here will affect all other notes that follow global settings.' : 'This note has its own settings that override the global defaults. Changes made here only affect this note.') : 'This note is not under version control. These are the default settings that will be applied.'}
                </p>
                <SettingComponent name="Enable version naming" desc="If enabled, prompts for a version name when saving a new version.">
                    <input type="checkbox" checked={settings.enableVersionNaming} onChange={e => updateSetting({ enableVersionNaming: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                <SettingComponent name="Compact list view" desc="Display version history as a compact list. Otherwise, shows as cards.">
                    <input type="checkbox" checked={settings.isListView} onChange={e => updateSetting({ isListView: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                <SettingComponent name="Use relative timestamps" desc="On: show relative times (e.g., '2 hours ago'). Off: show full date and time.">
                    <input type="checkbox" checked={settings.useRelativeTimestamps} onChange={e => updateSetting({ useRelativeTimestamps: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                <SettingComponent name="Render markdown in preview" desc="If enabled, version previews will render markdown. Otherwise, plain text.">
                    <input type="checkbox" checked={settings.renderMarkdownInPreview} onChange={e => updateSetting({ renderMarkdownInPreview: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                <SettingComponent name="Auto-save on file save" desc="Automatically save a new version whenever the note file is saved (e.g., via ctrl+s).">
                    <input type="checkbox" checked={settings.autoSaveOnSave} onChange={e => updateSetting({ autoSaveOnSave: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                {settings.autoSaveOnSave && (
                    <>
                        <SettingComponent name="Auto-save delay" desc={`Time to wait after last change before auto-saving. Current: ${settings.autoSaveOnSaveInterval} sec.`}>
                            <input type="range" min={1} max={10} step={1} value={settings.autoSaveOnSaveInterval} onChange={e => updateSetting({ autoSaveOnSaveInterval: Number(e.target.value) })} disabled={areControlsDisabled} />
                        </SettingComponent>
                        <MinLinesControl settings={settings} disabled={areControlsDisabled} />
                    </>
                )}
                <SettingComponent name="Enable watch mode" desc="Automatically save a new version if the note has changed after a set interval.">
                    <input type="checkbox" checked={settings.enableWatchMode} onChange={e => updateSetting({ enableWatchMode: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                {settings.enableWatchMode && (
                    <>
                        <SettingComponent name="Watch mode interval" desc={`Time to wait before auto-saving. Current: ${formatInterval(settings.watchModeInterval)}.`}>
                            <input type="range" min={5} max={300} step={5} value={settings.watchModeInterval} onChange={e => updateSetting({ watchModeInterval: Number(e.target.value) })} disabled={areControlsDisabled} />
                        </SettingComponent>
                        <MinLinesControl settings={settings} disabled={areControlsDisabled} />
                    </>
                )}
                <SettingComponent name="Auto-cleanup old versions by age" desc="Automatically delete versions older than a specified number of days. Keeps at least one version.">
                    <input type="checkbox" checked={settings.autoCleanupOldVersions} onChange={e => updateSetting({ autoCleanupOldVersions: e.target.checked })} disabled={areControlsDisabled} />
                </SettingComponent>
                {settings.autoCleanupOldVersions && (
                    <SettingComponent name="Delete versions older than (days)" desc={`Applies if "auto-cleanup by age" is on. Min 7, max 365. Current: ${settings.autoCleanupDays} days.`}>
                        <input type="range" min={7} max={365} step={1} value={settings.autoCleanupDays} onChange={e => updateSetting({ autoCleanupDays: Number(e.target.value) })} disabled={areControlsDisabled} />
                    </SettingComponent>
                )}
                <SettingComponent name="Max versions per note" desc={`Maximum number of versions to keep per note. Oldest versions are deleted first. Set to 0 for infinite. Current: ${settings.maxVersionsPerNote === 0 ? "infinite" : settings.maxVersionsPerNote}`}>
                    <input type="number" min={0} value={String(settings.maxVersionsPerNote)} onChange={e => {
                        const num = parseInt(e.target.value, 10);
                        if (!isNaN(num) && num >= 0) updateSetting({ maxVersionsPerNote: num });
                    }} disabled={areControlsDisabled} />
                </SettingComponent>
            </div>
        </>
    );
});
NoteSpecificSettings.displayName = 'NoteSpecificSettings';

export const SettingsPanel: FC = () => {
    const dispatch = useAppDispatch();
    const isActive = useAppSelector(state => state.panel?.type === 'settings');
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isActive) {
            return;
        }

        let timer: number;
        const resetTimer = () => {
            clearTimeout(timer);
            timer = window.setTimeout(() => {
                dispatch(thunks.closeSettingsPanelWithNotice("Settings panel auto-closed due to inactivity.", 2000));
            }, AUTO_CLOSE_DELAY_MS);
        };
        
        const panelEl = panelRef.current;
        if (panelEl) {
            panelEl.addEventListener('click', resetTimer, { capture: true });
            panelEl.addEventListener('input', resetTimer, { capture: true });
            resetTimer();
        }

        return () => {
            clearTimeout(timer);
            if (panelEl) {
                panelEl.removeEventListener('click', resetTimer, { capture: true });
                panelEl.removeEventListener('input', resetTimer, { capture: true });
            }
        };
    }, [dispatch, isActive]);

    return (
        <div className={clsx("v-settings-panel", { "is-active": isActive })}>
            <div ref={panelRef} className="v-settings-panel-content-wrapper">
                <GlobalSettings />
                <NoteSpecificSettings />
            </div>
        </div>
    );
};
