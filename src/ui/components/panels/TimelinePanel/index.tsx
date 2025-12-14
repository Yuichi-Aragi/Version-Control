import { type FC, useMemo, useCallback, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAppSelector } from '@/ui/hooks';
import { usePanelClose, useBackdropClick, usePanelSearch } from '@/ui/hooks';
import type { TimelinePanelProps } from '@/ui/components/panels/TimelinePanel/types';
import { TimelineHeader, TimelineEvent, TimelineEmpty } from '@/ui/components/panels/TimelinePanel/components';
import { useMatchController, useVirtualScroll } from '@/ui/components/panels/TimelinePanel/hooks';
import { sortEvents } from '@/ui/components/panels/TimelinePanel/utils';

export const TimelinePanel: FC<TimelinePanelProps> = ({ panelState }) => {
    const { events, settings } = panelState;
    const viewMode = useAppSelector(state => state.viewMode);
    const handleClose = usePanelClose();
    const handleBackdropClick = useBackdropClick(handleClose);
    const search = usePanelSearch();

    const sortedEvents = useMemo(() => sortEvents(events), [events]);

    const matchController = useMatchController(
        sortedEvents,
        search.searchQuery,
        search.isCaseSensitive
    );

    const { virtuosoRef } = useVirtualScroll(matchController.activeMatch);

    useEffect(() => {
        if (matchController.activeIndex >= 0) {
            search.setActiveMatchIndex(matchController.activeIndex);
        }
    }, [matchController.activeIndex, search]);

    const handleGoToMatch = useCallback((direction: 'next' | 'prev') => {
        matchController.navigateToMatch(direction);
    }, [matchController]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!search.isSearchActive) return;

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGoToMatch('next');
            } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                handleGoToMatch('prev');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [search.isSearchActive, handleGoToMatch]);

    return (
        <div className="v-panel-container is-active is-drawer-like" onClick={handleBackdropClick}>
            <div className="v-inline-panel v-timeline-panel is-drawer">
                <TimelineHeader
                    viewMode={viewMode}
                    settings={settings}
                    searchState={{
                        isSearchActive: search.isSearchActive,
                        searchQuery: search.searchQuery,
                        localSearchQuery: search.localSearchQuery,
                        isCaseSensitive: search.isCaseSensitive,
                        searchInputRef: search.searchInputRef,
                        handleToggleSearch: search.handleToggleSearch,
                        handleSearchInputChange: search.handleSearchInputChange,
                        handleClearSearch: search.handleClearSearch,
                        toggleCaseSensitivity: search.toggleCaseSensitivity
                    }}
                    matchController={{
                        activeIndex: matchController.activeIndex,
                        totalMatches: matchController.totalMatches
                    }}
                    onNavigateMatch={handleGoToMatch}
                />

                <div className="v-timeline-content">
                    {events === null || sortedEvents.length === 0 ? (
                        <TimelineEmpty isLoading={events === null} />
                    ) : (
                        <div className="v-timeline-list-container">
                            <Virtuoso
                                ref={virtuosoRef}
                                className="v-virtuoso-container"
                                data={sortedEvents}
                                itemContent={(index, event) => (
                                    <div className="v-timeline-item-wrapper">
                                        <TimelineEvent
                                            key={`${event.timestamp}-${index}`}
                                            event={event}
                                            settings={settings}
                                            index={index}
                                            searchQuery={search.searchQuery}
                                            isCaseSensitive={search.isCaseSensitive}
                                            activeMatch={
                                                matchController.activeMatch &&
                                                matchController.activeMatch.eventIndex === index
                                                    ? matchController.activeMatch
                                                    : null
                                            }
                                            isAutoExpanded={
                                                search.isSearchActive &&
                                                matchController.activeMatch?.eventIndex === index &&
                                                matchController.activeMatch?.type === 'diff'
                                            }
                                            viewMode={viewMode}
                                        />
                                    </div>
                                )}
                                increaseViewportBy={300}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export type { TimelinePanelProps };
