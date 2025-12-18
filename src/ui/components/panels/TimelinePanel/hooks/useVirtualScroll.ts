import { useRef, useEffect } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { TimelineMatch, UseVirtualScrollReturn } from '@/ui/components/panels/TimelinePanel/types';

export const useVirtualScroll = (activeMatch: TimelineMatch | null): UseVirtualScrollReturn => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    useEffect(() => {
        if (activeMatch && virtuosoRef.current) {
            // Use instant scrolling ('auto') for match navigation to avoid lag
            // waiting for smooth scroll animations to complete
            const scrollTimer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: activeMatch.eventIndex,
                    align: 'start',
                    behavior: 'auto', 
                    offset: -20
                });
            }, 0); // Immediate execution on next tick

            return () => clearTimeout(scrollTimer);
        }
        return undefined;
    }, [activeMatch]);

    const scrollToIndex = (index: number) => {
        virtuosoRef.current?.scrollToIndex({
            index,
            align: 'start',
            behavior: 'auto'
        });
    };

    return {
        virtuosoRef,
        scrollToIndex
    };
};
