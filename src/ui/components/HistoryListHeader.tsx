import type { FC } from 'react';
import { useMemo } from 'react';
import { AppStatus } from '../../state/state';

interface HistoryListHeaderProps {
    status: AppStatus;
    filteredCount: number;
    totalCount: number;
}

export const HistoryListHeader: FC<HistoryListHeaderProps> = ({ status, filteredCount, totalCount }) => {
    const countText = useMemo(() => {
        if (status === AppStatus.LOADING) return 'Loading...';
        if (filteredCount !== totalCount) {
            return `${filteredCount} of ${totalCount} versions`;
        }
        return `${totalCount} ${totalCount === 1 ? 'version' : 'versions'}`;
    }, [status, filteredCount, totalCount]);

    if (totalCount === 0 && status === AppStatus.READY) {
        return null; // Don't show header if there are no versions
    }

    return (
        <div className="v-history-header">
            <span>Version History</span>
            <span className="v-history-count">{countText}</span>
        </div>
    );
};
