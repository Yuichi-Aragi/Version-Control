import { useRef, useEffect } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { TimelineMatch, UseVirtualScrollReturn } from '@/ui/components/panels/TimelinePanel/types';

export const useVirtualScroll = (activeMatch: TimelineMatch | null): UseVirtualScrollReturn => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    useEffect(() => {
        if (activeMatch && virtuosoRef.current) {
            const scrollTimer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: activeMatch.eventIndex,
                    align: 'start',
                    behavior: 'smooth',
                    offset: -20
                });
            }, 50);

            return () => clearTimeout(scrollTimer);
        }
        return undefined;
    }, [activeMatch]);

    const scrollToIndex = (index: number) => {
        virtuosoRef.current?.scrollToIndex({
            index,
            align: 'start',
            behavior: 'smooth'
        });
    };

    return {
        virtuosoRef,
        scrollToIndex
    };
};
