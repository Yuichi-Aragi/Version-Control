import { memo, useCallback } from 'react';
import { isEqual } from 'es-toolkit';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
import { thunks } from '@/state';
import { SettingsAction } from './SettingsAction';
import { IsGlobalSetting } from './setting-controls/IsGlobalSetting';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';

export const NoteSpecificSettings: React.FC = memo(() => {
    const dispatch = useAppDispatch();
    const { status, file, noteId, history, editHistory, isGlobal, viewMode } = useAppSelector(state => ({
        status: state.status,
        file: state.file,
        noteId: state.noteId,
        history: state.history,
        editHistory: state.editHistory,
        isGlobal: state.effectiveSettings.isGlobal,
        viewMode: state.viewMode,
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
        const hasItems = viewMode === 'versions' ? history.length > 0 : editHistory.length > 0;
        if (noteId && hasItems) {
            dispatch(thunks.requestDeleteAll());
        }
    }, [dispatch, noteId, history.length, editHistory.length, viewMode]);
    
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
    const modeLabel = viewMode === 'versions' ? 'Version History' : 'Edit History';
    const deleteLabel = viewMode === 'versions' ? 'Delete all versions' : 'Delete all edits';
    const hasItems = viewMode === 'versions' ? history.length > 0 : editHistory.length > 0;

    return (
        <>
            <div className="v-settings-section" role="region" aria-labelledby="note-actions-title">
                <h4 id="note-actions-title">
                    Actions for "{file.basename}"
                </h4>
                <div className="v-settings-actions">
                    {/* Primary Actions - Top Row */}
                    <SettingsAction text="Refresh history" icon="refresh-cw" onClick={handleRefresh} />
                    <SettingsAction text="Export history" icon="download-cloud" onClick={handleExport} disabled={!noteId} />
                    
                    {/* Meta/Support Actions - Middle Row */}
                    <SettingsAction text="View Changelog" icon="file-text" onClick={handleViewChangelog} />
                    <SettingsAction text="Report Issue" icon="bug" onClick={handleReportIssue} />
                    
                    {/* Destructive Action - Bottom Row (Full Width) */}
                    <SettingsAction 
                        text={deleteLabel}
                        icon="trash-2" 
                        onClick={handleDeleteAll} 
                        isWarning 
                        disabled={!noteId || !hasItems} 
                    />
                </div>
            </div>
            <div className="v-settings-section" role="region" aria-labelledby="note-settings-title">
                <h4 id="note-settings-title">
                    {noteId ? `${modeLabel} Settings (Current Branch)` : 'Default settings'}
                </h4>
                {noteId && <IsGlobalSetting disabled={areControlsDisabled} />}
                <p className="v-settings-info">
                    {noteId ? (
                        isGlobal ? 
                            `This note follows the global ${modeLabel.toLowerCase()} settings. Changes made here will affect all other notes that follow global settings.` : 
                            `This note has its own ${modeLabel.toLowerCase()} settings for the current branch. Changes made here only affect this note.`
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
