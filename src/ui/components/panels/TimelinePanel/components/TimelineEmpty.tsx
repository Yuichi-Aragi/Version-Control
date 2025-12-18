import type { FC } from 'react';
import { motion } from 'framer-motion';
import type { TimelineEmptyProps } from '@/ui/components/panels/TimelinePanel/types';

export const TimelineEmpty: FC<TimelineEmptyProps> = ({ isLoading }) => {
    if (isLoading) {
        return (
            <motion.div 
                className="v-timeline-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <div className="loading-spinner" />
                <p>Loading timeline...</p>
            </motion.div>
        );
    }

    return (
        <motion.div 
            className="v-timeline-empty"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
        >
            No history events found.
        </motion.div>
    );
};
