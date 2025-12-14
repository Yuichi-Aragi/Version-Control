import type { TimelineEvent } from '@/state';

export const sortEvents = (events: TimelineEvent[] | null): TimelineEvent[] => {
    if (!events) return [];
    return [...events].reverse();
};
