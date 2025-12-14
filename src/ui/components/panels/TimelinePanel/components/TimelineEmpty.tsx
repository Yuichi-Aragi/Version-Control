import type { FC } from 'react';
import type { TimelineEmptyProps } from '@/ui/components/panels/TimelinePanel/types';

export const TimelineEmpty: FC<TimelineEmptyProps> = ({ isLoading }) => {
    if (isLoading) {
        return (
            <div className="v-timeline-loading">
                <div className="loading-spinner" />
                <p>Loading timeline...</p>
            </div>
        );
    }

    return (
        <div className="v-timeline-empty">No history events found.</div>
    );
};
