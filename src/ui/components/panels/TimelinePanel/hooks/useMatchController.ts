import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimelineEvent } from '@/state';
import type { MatchController, UseMatchControllerReturn } from '@/ui/components/panels/TimelinePanel/types';
import { findMatches } from '@/ui/components/panels/TimelinePanel/utils';

export const useMatchController = (
    sortedEvents: TimelineEvent[],
    searchQuery: string,
    isCaseSensitive: boolean
): UseMatchControllerReturn => {
    const [controller, setController] = useState<MatchController>({
        matches: [],
        activeIndex: -1,
        isLoading: false
    });

    const calculationIdRef = useRef(0);

    useEffect(() => {
        if (!searchQuery || !sortedEvents.length) {
            setController({
                matches: [],
                activeIndex: -1,
                isLoading: false
            });
            return undefined;
        }

        setController(prev => ({ ...prev, isLoading: true }));

        const currentCalculationId = ++calculationIdRef.current;
        let isCancelled = false;

        const animationFrameId = requestAnimationFrame(() => {
            if (isCancelled || currentCalculationId !== calculationIdRef.current) return;

            const matches = findMatches(sortedEvents, searchQuery, isCaseSensitive);

            setController({
                matches,
                activeIndex: matches.length > 0 ? 0 : -1,
                isLoading: false
            });
        });

        return () => {
            isCancelled = true;
            cancelAnimationFrame(animationFrameId);
            if (currentCalculationId === calculationIdRef.current) {
                calculationIdRef.current = 0;
            }
        };
    }, [sortedEvents, searchQuery, isCaseSensitive]);

    const navigateToMatch = useCallback((direction: 'next' | 'prev' | 'specific', specificIndex?: number) => {
        setController(prev => {
            if (prev.matches.length === 0) return prev;

            let newActiveIndex: number;

            if (direction === 'specific' && specificIndex !== undefined) {
                newActiveIndex = Math.max(0, Math.min(specificIndex, prev.matches.length - 1));
            } else {
                const delta = direction === 'next' ? 1 : -1;
                newActiveIndex = (prev.activeIndex + delta + prev.matches.length) % prev.matches.length;
            }

            return {
                ...prev,
                activeIndex: newActiveIndex
            };
        });
    }, []);

    return {
        matches: controller.matches,
        activeMatch: controller.matches[controller.activeIndex] || null,
        activeIndex: controller.activeIndex,
        isLoading: controller.isLoading,
        navigateToMatch,
        totalMatches: controller.matches.length
    };
};
