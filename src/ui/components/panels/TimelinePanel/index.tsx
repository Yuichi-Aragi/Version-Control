import { type FC, useMemo, useCallback, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion } from 'framer-motion';
import { useAppSelector } from '@/ui/hooks';
import { usePanelClose, useBackdropClick, usePanelSearch } from '@/ui/hooks';
import type { TimelinePanelProps } from '@/ui/components/panels/TimelinePanel/types';
import { TimelineHeader, TimelineEvent, TimelineEmpty } from '@/ui/components/panels/TimelinePanel/components';
import { useMatchController, useVirtualScroll } from '@/ui/components/panels/TimelinePanel/hooks';
import { sortEvents } from '@/ui/components/panels/TimelinePanel/utils';
import { useGetTimelineQuery } from '@/state/apis/history.api';

export const TimelinePanel: FC<TimelinePanelProps> = ({ panelState: _ }) => {
    // Selectors
    const noteId = useAppSelector(state => state.app.noteId);
    const currentBranch = useAppSelector(state => state.app.currentBranch);
    const viewMode = useAppSelector(state => state.app.viewMode);

    // RTK Query
    const { data, isLoading } = useGetTimelineQuery(
        { noteId: noteId!, branchName: currentBranch!, viewMode },
        { skip: !noteId || !currentBranch }
    );

    const events = data?.events ?? null;
    const settings = data?.settings ?? {
        showDescription: false,
        showName: true,
        showVersionNumber: true,
        showPreview: true,
        expandByDefault: false,
    };

    // Hooks
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
        <div className="v-panel-container is-active is-timeline-container" onClick={handleBackdropClick}>
            <motion.div 
                className="v-inline-panel v-timeline-panel"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
            >
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
                    {events === null || (sortedEvents.length === 0 && !isLoading) ? (
                        <TimelineEmpty isLoading={isLoading} />
                    ) : (
                        <div className="v-timeline-list-container">
                            <Virtuoso
                                ref={virtuosoRef}
                                className="v-virtuoso-container"
                                data={sortedEvents}
                                itemContent={(index, event) => (
                                    <motion.div 
                                        className="v-timeline-item-wrapper"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.15, ease: "easeOut" }}
                                    >
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
                                    </motion.div>
                                )}
                                increaseViewportBy={300}
                            />
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};
