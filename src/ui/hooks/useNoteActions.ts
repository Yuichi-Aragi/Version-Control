import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';

export const useNoteActions = () => {
    const dispatch = useAppDispatch();
    const { file, noteId, history, editHistory, viewMode } = useAppSelector(state => ({
        file: state.file,
        noteId: state.noteId,
        history: state.history,
        editHistory: state.editHistory,
        viewMode: state.viewMode,
    }));

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

    const hasItems = viewMode === 'versions' ? history.length > 0 : editHistory.length > 0;
    const deleteLabel = viewMode === 'versions' ? 'Delete all versions' : 'Delete all edits';

    return {
        handleRefresh,
        handleExport,
        handleDeleteAll,
        handleViewChangelog,
        handleReportIssue,
        hasItems,
        deleteLabel,
        noteId,
        file
    };
};
