import { type FC, useMemo, useState, memo, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import { moment } from 'obsidian';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppDispatch } from '../../hooks/useRedux';
import { thunks } from '../../../state/thunks';
import type { TimelinePanel as TimelinePanelState, TimelineEvent } from '../../../state/state';
import type { TimelineSettings } from '../../../types';
import { Icon } from '../Icon';
import { usePanelClose } from '../../hooks/usePanelClose';
import { useBackdropClick } from '../../hooks/useBackdropClick';
import { VirtualizedDiff, processLineChanges } from '../shared/VirtualizedDiff';
import { usePanelSearch } from '../../hooks/usePanelSearch';
import { escapeRegExp } from '../../utils/strings';
import { HighlightedText } from '../shared/HighlightedText';

interface TimelinePanelProps {
    panelState: TimelinePanelState;
}

interface TimelineMatch {
    eventIndex: number;
    type: 'metadata' | 'diff';
    lineIndex?: number;
    matchIndexInLine?: number;
}

interface MatchController {
    matches: TimelineMatch[];
    activeIndex: number;
    isLoading: boolean;
    pendingExpansion: Set<number>;
}

const useMatchController = (
    sortedEvents: TimelineEvent[],
    searchQuery: string,
    isCaseSensitive: boolean
) => {
    const [controller, setController] = useState<MatchController>({
        matches: [],
        activeIndex: -1,
        isLoading: false,
        pendingExpansion: new Set()
    });

    const calculationIdRef = useRef(0);

    useEffect(() => {
        if (!searchQuery || !sortedEvents.length) {
            setController({
                matches: [],
                activeIndex: -1,
                isLoading: false,
                pendingExpansion: new Set()
            });
            return undefined;
        }

        setController(prev => ({ ...prev, isLoading: true }));
        
        const currentCalculationId = ++calculationIdRef.current;
        let isCancelled = false;

        const calculateMatches = () => {
            const results: TimelineMatch[] = [];
            const regex = new RegExp(escapeRegExp(searchQuery), isCaseSensitive ? 'g' : 'gi');

            sortedEvents.forEach((event, eventIndex) => {
                const metaStrings = [
                    event.toVersionName,
                    `V${event.toVersionNumber}`,
                    event.toVersionDescription,
                    (moment as any)(event.timestamp).format('MMM D, YYYY h:mm A'),
                    String(event.stats.additions),
                    String(event.stats.deletions)
                ];

                let metaMatchFound = false;
                for (const str of metaStrings) {
                    if (str && regex.test(str)) {
                        metaMatchFound = true;
                        break;
                    }
                }
                
                if (metaMatchFound) {
                    results.push({ eventIndex, type: 'metadata' });
                }

                const lines = processLineChanges(event.diffData, 'smart');
                lines.forEach((line, lineIndex) => {
                    if (line.type === 'collapsed') return;
                    
                    regex.lastIndex = 0;
                    const lineMatches = [...line.content.matchAll(regex)];
                    
                    lineMatches.forEach((_, matchIndex) => {
                        results.push({
                            eventIndex,
                            type: 'diff',
                            lineIndex,
                            matchIndexInLine: matchIndex
                        });
                    });
                });
            });

            return results;
        };

        const animationFrameId = requestAnimationFrame(() => {
            if (isCancelled || currentCalculationId !== calculationIdRef.current) return;

            const matches = calculateMatches();
            
            setController({
                matches,
                activeIndex: matches.length > 0 ? 0 : -1,
                isLoading: false,
                pendingExpansion: new Set(
                    matches.length > 0 ? [matches[0]!.eventIndex] : []
                )
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

            const newPendingExpansion = new Set(prev.pendingExpansion);
            newPendingExpansion.add(prev.matches[newActiveIndex]?.eventIndex ?? 0);

            return {
                ...prev,
                activeIndex: newActiveIndex,
                pendingExpansion: newPendingExpansion
            };
        });
    }, []);

    const completeExpansion = useCallback((eventIndex: number) => {
        setController(prev => {
            const newPendingExpansion = new Set(prev.pendingExpansion);
            newPendingExpansion.delete(eventIndex);
            return { ...prev, pendingExpansion: newPendingExpansion };
        });
    }, []);

    return {
        matches: controller.matches,
        activeMatch: controller.matches[controller.activeIndex] || null,
        activeIndex: controller.activeIndex,
        isLoading: controller.isLoading,
        pendingExpansion: controller.pendingExpansion,
        navigateToMatch,
        completeExpansion,
        totalMatches: controller.matches.length
    };
};

interface TimelineCardProps {
    event: TimelineEvent;
    settings: TimelineSettings;
    index: number;
    searchQuery: string;
    isCaseSensitive: boolean;
    activeMatch: TimelineMatch | null;
    needsExpansion: boolean;
    onExpansionComplete: () => void;
}

const TimelineCard: FC<TimelineCardProps> = memo(({ 
    event, 
    settings, 
    index, 
    searchQuery, 
    isCaseSensitive,
    activeMatch,
    needsExpansion,
    onExpansionComplete
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const expansionTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    useEffect(() => {
        if (!settings.expandByDefault) {
            setIsExpanded(false);
            return undefined;
        }

        const delay = (index % 15) * 40;
        expansionTimeoutRef.current = setTimeout(() => {
            setIsExpanded(true);
        }, delay);
        
        return () => {
            if (expansionTimeoutRef.current) {
                clearTimeout(expansionTimeoutRef.current);
            }
        };
    }, [settings.expandByDefault, index]);

    useEffect(() => {
        if (!needsExpansion) return undefined;

        let isCancelled = false;
        
        const performExpansion = () => {
            if (isCancelled) return;
            
            setIsExpanding(true);
            
            if (!isExpanded) {
                setIsExpanded(true);
            }
            
            const scrollDelay = activeMatch?.type === 'diff' ? 150 : 50;
            
            expansionTimeoutRef.current = setTimeout(() => {
                if (isCancelled) return;
                
                if (activeMatch?.type === 'diff' && activeMatch.lineIndex !== undefined) {
                    virtuosoRef.current?.scrollToIndex({
                        index: activeMatch.lineIndex,
                        align: 'center',
                        behavior: 'smooth'
                    });
                }
                
                setIsExpanding(false);
                onExpansionComplete();
            }, scrollDelay);
        };

        performExpansion();

        return () => {
            isCancelled = true;
            if (expansionTimeoutRef.current) {
                clearTimeout(expansionTimeoutRef.current);
            }
        };
    }, [needsExpansion, activeMatch, isExpanded, onExpansionComplete]);

    const timestampText = useMemo(() => {
        return (moment as any)(event.timestamp).format('MMM D, YYYY h:mm A');
    }, [event.timestamp]);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(prev => !prev);
    };

    const showVersion = settings.showVersionNumber;
    const showName = settings.showName && !!event.toVersionName;
    const showDesc = settings.showDescription && !!event.toVersionDescription;
    const isTimestampFocused = !showName && !showVersion;

    const highlightProps = {
        query: searchQuery,
        caseSensitive: isCaseSensitive
    };

    return (
        <div className={clsx("v-timeline-card", { 
            "is-expanded": isExpanded,
            "is-expanding": isExpanding,
            "has-active-match": !!activeMatch 
        })} onClick={handleToggle}>
            <div className="v-timeline-card-header">
                <div className="v-timeline-content-column">
                    <div className="v-timeline-header-row">
                        <div className={clsx("v-timeline-header-left", { "is-collapsed": isTimestampFocused })}>
                            {showVersion && (
                                <span className="v-timeline-version-badge">
                                    V{event.toVersionNumber}
                                </span>
                            )}
                            {showName && (
                                <span className="v-timeline-title">
                                    <HighlightedText text={event.toVersionName || ''} {...highlightProps} />
                                </span>
                            )}
                        </div>

                        <div className={clsx("v-timeline-spacer", { "is-collapsed": isTimestampFocused })} />

                        <span className={clsx("v-timeline-time", { "is-focused": isTimestampFocused })}>
                            <HighlightedText text={timestampText} {...highlightProps} />
                        </span>
                    </div>

                    {showDesc && (
                        <div className="v-timeline-description">
                            <HighlightedText text={event.toVersionDescription || ''} {...highlightProps} />
                        </div>
                    )}

                    <div className="v-timeline-stats-row">
                        <div className="v-timeline-stats">
                            <span className="v-stat-add" title="Additions">
                                +<HighlightedText text={String(event.stats.additions)} {...highlightProps} />
                            </span>
                            <span className="v-stat-del" title="Deletions">
                                -<HighlightedText text={String(event.stats.deletions)} {...highlightProps} />
                            </span>
                        </div>
                    </div>
                </div>
                
                <div className="v-timeline-expand-icon">
                    <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} />
                </div>
            </div>
            
            <div className="v-timeline-card-diff-container">
                <div className="v-timeline-diff-inner">
                    <div className="v-timeline-diff-content" onClick={e => e.stopPropagation()}>
                        {isExpanded && (
                            <VirtualizedDiff
                                changes={event.diffData}
                                diffType="smart"
                                virtuosoHandleRef={virtuosoRef}
                                activeMatchInfo={
                                    activeMatch?.type === 'diff' 
                                        ? { 
                                            lineIndex: activeMatch.lineIndex ?? 0, 
                                            matchIndexInLine: activeMatch.matchIndexInLine ?? 0
                                          } 
                                        : null
                                }
                                activeUnifiedMatchIndex={-1}
                                searchQuery={searchQuery}
                                isCaseSensitive={isCaseSensitive}
                                highlightedIndex={activeMatch?.type === 'diff' ? (activeMatch.lineIndex ?? null) : null}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
TimelineCard.displayName = 'TimelineCard';

export const TimelinePanel: FC<TimelinePanelProps> = ({ panelState }) => {
    const { events, settings } = panelState;
    const handleClose = usePanelClose();
    const handleBackdropClick = useBackdropClick(handleClose);
    const search = usePanelSearch();
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const sortedEvents = useMemo(() => {
        if (!events) return [];
        return [...events].reverse();
    }, [events]);

    const matchController = useMatchController(
        sortedEvents,
        search.searchQuery,
        search.isCaseSensitive
    );

    useEffect(() => {
        if (matchController.activeMatch && virtuosoRef.current) {
            const scrollTimer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: matchController.activeMatch!.eventIndex,
                    align: 'start',
                    behavior: 'smooth',
                    offset: -20
                });
            }, 50);

            return () => clearTimeout(scrollTimer);
        }
        return undefined;
    }, [matchController.activeMatch]);

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
                <div className={clsx("v-panel-header", { 'is-searching': search.isSearchActive })}>
                    <div className="v-panel-header-content">
                        <h3>Timeline</h3>
                        <div className="v-panel-header-actions">
                            <button className="clickable-icon" onClick={search.handleToggleSearch}>
                                <Icon name="search" />
                            </button>
                            <TimelineSettingsMenu settings={settings} />
                        </div>
                    </div>
                    
                    <div className="v-panel-search-bar-container" onClick={e => e.stopPropagation()}>
                        <div className="v-search-input-wrapper">
                            <div className="v-search-icon" role="button" onClick={search.handleToggleSearch}>
                                <Icon name="x-circle" />
                            </div>
                            <input
                                ref={search.searchInputRef}
                                type="search"
                                placeholder="Search timeline..."
                                value={search.localSearchQuery}
                                onChange={search.handleSearchInputChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { 
                                        e.preventDefault(); 
                                        handleGoToMatch(e.shiftKey ? 'prev' : 'next'); 
                                    }
                                    if (e.key === 'Escape') search.handleToggleSearch();
                                }}
                            />
                            <div className="v-search-input-buttons">
                                {search.searchQuery && matchController.totalMatches > 0 && (
                                    <span className="v-search-match-count">
                                        {matchController.activeIndex + 1} / {matchController.totalMatches}
                                    </span>
                                )}
                                <button 
                                    className="clickable-icon" 
                                    disabled={matchController.totalMatches === 0} 
                                    onClick={() => handleGoToMatch('prev')}
                                >
                                    <Icon name="chevron-up" />
                                </button>
                                <button 
                                    className="clickable-icon" 
                                    disabled={matchController.totalMatches === 0} 
                                    onClick={() => handleGoToMatch('next')}
                                >
                                    <Icon name="chevron-down" />
                                </button>
                                <button 
                                    className={clsx('clickable-icon', { 'is-active': search.isCaseSensitive })} 
                                    onClick={search.toggleCaseSensitivity}
                                >
                                    <Icon name="case-sensitive" />
                                </button>
                                <button 
                                    className={clsx('clickable-icon', { 'is-hidden': !search.localSearchQuery })} 
                                    onClick={search.handleClearSearch}
                                >
                                    <Icon name="x" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="v-timeline-content">
                    {events === null ? (
                        <div className="v-timeline-loading">
                            <div className="loading-spinner" />
                            <p>Loading timeline...</p>
                        </div>
                    ) : sortedEvents.length === 0 ? (
                        <div className="v-timeline-empty">No history events found.</div>
                    ) : (
                        <div className="v-timeline-list-container">
                            <Virtuoso
                                ref={virtuosoRef}
                                className="v-virtuoso-container"
                                data={sortedEvents}
                                itemContent={(index, event) => (
                                    <div className="v-timeline-item-wrapper">
                                        <TimelineCard 
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
                                            needsExpansion={matchController.pendingExpansion.has(index)}
                                            onExpansionComplete={() => matchController.completeExpansion(index)}
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

const TimelineSettingsMenu: FC<{ settings: TimelineSettings }> = ({ settings }) => {
    const dispatch = useAppDispatch();

    const toggle = (key: keyof TimelineSettings) => {
        dispatch(thunks.updateTimelineSettings({ [key]: !settings[key] }));
    };

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button className="clickable-icon" aria-label="Timeline Settings">
                    <Icon name="settings-2" />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="v-actionbar-dropdown-content" sideOffset={5} collisionPadding={10}>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showName'); }}>
                        <span>Show Name</span>
                        {settings.showName && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showVersionNumber'); }}>
                        <span>Show Version Number</span>
                        {settings.showVersionNumber && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showDescription'); }}>
                        <span>Show Description</span>
                        {settings.showDescription && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('expandByDefault'); }}>
                        <span>Expand Cards by Default</span>
                        {settings.expandByDefault && <Icon name="check" />}
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
