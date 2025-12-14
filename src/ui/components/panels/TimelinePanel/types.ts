import type { TimelinePanel as TimelinePanelState, TimelineEvent } from '@/state';
import type { TimelineSettings } from '@/types';
import type { VirtuosoHandle } from 'react-virtuoso';

export interface TimelinePanelProps {
    panelState: TimelinePanelState;
}

export interface TimelineMatch {
    eventIndex: number;
    type: 'metadata' | 'diff';
    lineIndex?: number;
    matchIndexInLine?: number;
}

export interface MatchController {
    matches: TimelineMatch[];
    activeIndex: number;
    isLoading: boolean;
}

export interface TimelineEventProps {
    event: TimelineEvent;
    settings: TimelineSettings;
    index: number;
    searchQuery: string;
    isCaseSensitive: boolean;
    activeMatch: TimelineMatch | null;
    isAutoExpanded: boolean;
    viewMode: 'versions' | 'edits';
}

export interface TimelineHeaderProps {
    viewMode: 'versions' | 'edits';
    settings: TimelineSettings;
    searchState: {
        isSearchActive: boolean;
        searchQuery: string;
        localSearchQuery: string;
        isCaseSensitive: boolean;
        searchInputRef: React.RefObject<HTMLInputElement | null>;
        handleToggleSearch: () => void;
        handleSearchInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        handleClearSearch: (e: React.MouseEvent) => void;
        toggleCaseSensitivity: () => void;
    };
    matchController: {
        activeIndex: number;
        totalMatches: number;
    };
    onNavigateMatch: (direction: 'next' | 'prev') => void;
}

export interface TimelineFiltersProps {
    settings: TimelineSettings;
}

export interface TimelineEmptyProps {
    isLoading: boolean;
}

export interface UseMatchControllerReturn {
    matches: TimelineMatch[];
    activeMatch: TimelineMatch | null;
    activeIndex: number;
    isLoading: boolean;
    navigateToMatch: (direction: 'next' | 'prev' | 'specific', specificIndex?: number) => void;
    totalMatches: number;
}

export interface UseVirtualScrollReturn {
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    scrollToIndex: (index: number) => void;
}
