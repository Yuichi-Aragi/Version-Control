import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { AppStatus } from '../../../state/state';
import { thunks } from '../../../state/thunks';
import { SettingsAction } from './SettingsAction';
import { IsGlobalSetting } from './setting-controls/IsGlobalSetting';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';

export const NoteSpecificSettings: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const { status, file, noteId, history, isGlobal } = useAppSelector(state => ({
        status: state.status,
        file: state.file,
        noteId: state.noteId,
        history: state.history,
        isGlobal: state.settings.isGlobal,
    }), isEqual);

    const handleRefresh = useCallback(() => {
        if (!file) return;
        dispatch(thunks.loadHistory(file));
        dispatch(thunks.closeSettingsPanelWithNotice("History refreshed.", 1500));
    }, [dispatch, file]);
    
    const handleExport = useCallback(() => {
        if (!noteId) {
            dispatch(thunks.showNotice("This note is not under version control yet. Cannot export history.", 3000));
            return;
        }
        dispatch(thunks.requestExportAllVersions());
    }, [dispatch, noteId]);
    
    const handleDeleteAll = useCallback(() => {
        if (noteId && history.length > 0) {
            dispatch(thunks.requestDeleteAll());
        }
    }, [dispatch, noteId, history.length]);
    
    const handleViewChangelog = useCallback(() => {
        dispatch(thunks.showChangelogPanel({ forceRefresh: true }));
    }, [dispatch]);
    
    const handleReportIssue = useCallback(() => {
        try {
            window.open('https://github.com/Yuichi-Aragi/Version-Control/issues', '_blank', 'noopener,noreferrer');
        } catch (error) {
            console.error('Error opening issue tracker:', error);
        }
    }, []);

    if (status !== AppStatus.READY || !file) return null;
    const areControlsDisabled = !noteId;

    return (
        <>
            <div className="v-settings-section" role="region" aria-labelledby="note-actions-title">
                <h4 id="note-actions-title">
                    Actions for "{file.basename}"
                </h4>
                <div className="v-settings-actions">
                    <SettingsAction text="Refresh history" icon="refresh-cw" onClick={handleRefresh} />
                    <SettingsAction text="Export history" icon="download-cloud" onClick={handleExport} disabled={!noteId} />
                    <SettingsAction 
                        text="Delete all versions" 
                        icon="trash-2" 
                        onClick={handleDeleteAll} 
                        isWarning 
                        disabled={!noteId || history.length === 0} 
                    />
                    <SettingsAction text="View Changelog" icon="file-text" onClick={handleViewChangelog} />
                    <SettingsAction text="Report Issue" icon="bug" onClick={handleReportIssue} />
                </div>
            </div>
            <div className="v-settings-section" role="region" aria-labelledby="note-settings-title">
                <h4 id="note-settings-title">
                    {noteId ? 'Note-specific settings' : 'Default settings'}
                </h4>
                {noteId && <IsGlobalSetting disabled={areControlsDisabled} />}
                <p className="v-settings-info">
                    {noteId ? (
                        isGlobal ? 
                            'This note follows the global settings. Changes made here will affect all other notes that follow global settings.' : 
                            'This note has its own settings that override the global defaults. Changes made here only affect this note.'
                    ) : 
                        'This note is not under version control. These are the default settings that will be applied.'
                    }
                </p>
                <NoteSettingsControls disabled={areControlsDisabled} />
            </div>
        </>
    );
});
NoteSpecificSettings.displayName = 'NoteSpecificSettings';
