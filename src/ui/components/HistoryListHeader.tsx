import clsx from 'clsx';
import type { FC } from 'react';
import { useMemo, useCallback } from 'react';
import { AppStatus } from '../../state/state';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { thunks } from '../../state/thunks';

interface HistoryListHeaderProps {
    status: AppStatus;
    filteredCount: number;
    totalCount: number;
}

export const HistoryListHeader: FC<HistoryListHeaderProps> = ({ status, filteredCount, totalCount }) => {
    const dispatch = useAppDispatch();
    const { viewMode } = useAppSelector(state => ({
        viewMode: state.viewMode,
    }));

    const countText = useMemo(() => {
        if (status === AppStatus.LOADING) return 'Loading...';
        const noun = viewMode === 'versions' ? 'version' : 'edit';
        if (filteredCount !== totalCount) {
            return `${filteredCount} of ${totalCount} ${noun}s`;
        }
        return `${totalCount} ${totalCount === 1 ? noun : noun + 's'}`;
    }, [status, filteredCount, totalCount, viewMode]);

    const handleToggleMode = useCallback(() => {
        dispatch(thunks.toggleViewMode());
    }, [dispatch]);

    if (totalCount === 0 && status === AppStatus.READY && viewMode === 'versions') {
        // Keep header visible to allow switching to Edit History even if Version History is empty
    }

    // Always show header if ready to allow toggling
    if (status !== AppStatus.READY) return null;

    return (
        <div className="v-history-header">
            <span 
                className={clsx("v-history-title-toggle", "clickable-text")} 
                onClick={handleToggleMode}
                title={`Switch to ${viewMode === 'versions' ? 'Edit History' : 'Version History'}`}
            >
                {viewMode === 'versions' ? 'Version History' : 'Edit History'}
            </span>
            <span className="v-history-count">{countText}</span>
        </div>
    );
};
