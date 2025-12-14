import { type FC, useMemo, useState, memo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { moment } from 'obsidian';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Icon } from '@/ui/components';
import { VirtualizedDiff, StaticDiff } from '@/ui/components/shared/VirtualizedDiff';
import { HighlightedText } from '@/ui/components/shared';
import type { TimelineEventProps } from '@/ui/components/panels/TimelinePanel/types';

export const TimelineEvent: FC<TimelineEventProps> = memo(({
    event,
    settings,
    index,
    searchQuery,
    isCaseSensitive,
    activeMatch,
    isAutoExpanded,
    viewMode
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [renderMode, setRenderMode] = useState<'virtual' | 'static'>('virtual');
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
        if (isAutoExpanded) {
            setIsExpanded(true);
            setRenderMode('static');
        } else if (renderMode === 'static') {
            setIsExpanded(false);
            setRenderMode('virtual');
        }
    }, [isAutoExpanded, renderMode]);

    const timestampText = useMemo(() => {
        return (moment as any)(event.timestamp).format('MMM D, YYYY h:mm A');
    }, [event.timestamp]);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(prev => {
            const newState = !prev;
            if (renderMode === 'static') {
                setRenderMode('virtual');
            }
            return newState;
        });
    };

    const showVersion = settings.showVersionNumber;
    const showName = settings.showName && !!event.toVersionName;
    const showDesc = settings.showDescription && !!event.toVersionDescription;
    const isTimestampFocused = !showName && !showVersion;

    const highlightProps = {
        query: searchQuery,
        caseSensitive: isCaseSensitive
    };

    const prefix = viewMode === 'edits' ? 'E' : 'V';

    return (
        <div className={clsx('v-timeline-card', {
            'is-expanded': isExpanded,
            'has-active-match': !!activeMatch
        })} onClick={handleToggle}>
            <div className="v-timeline-card-header">
                <div className="v-timeline-content-column">
                    <div className="v-timeline-header-row">
                        <div className={clsx('v-timeline-header-left', { 'is-collapsed': isTimestampFocused })}>
                            {showVersion && (
                                <span className="v-timeline-version-badge">
                                    {prefix}{event.toVersionNumber}
                                </span>
                            )}
                            {showName && (
                                <span className="v-timeline-title">
                                    <HighlightedText text={event.toVersionName || ''} {...highlightProps} />
                                </span>
                            )}
                        </div>

                        <div className={clsx('v-timeline-spacer', { 'is-collapsed': isTimestampFocused })} />

                        <span className={clsx('v-timeline-time', { 'is-focused': isTimestampFocused })}>
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
                            renderMode === 'static' ? (
                                <StaticDiff
                                    changes={event.diffData}
                                    diffType="smart"
                                    activeMatchInfo={
                                        activeMatch?.type === 'diff'
                                            ? {
                                                lineIndex: activeMatch.lineIndex ?? 0,
                                                matchIndexInLine: activeMatch.matchIndexInLine ?? 0
                                            }
                                            : null
                                    }
                                    searchQuery={searchQuery}
                                    isCaseSensitive={isCaseSensitive}
                                />
                            ) : (
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
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

TimelineEvent.displayName = 'TimelineEvent';
