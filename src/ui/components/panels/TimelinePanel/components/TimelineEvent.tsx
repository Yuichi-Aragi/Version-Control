import { type FC, useMemo, useState, memo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { moment } from 'obsidian';
import type { VirtuosoHandle } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { VirtualizedDiff, StaticDiff } from '@/ui/components/shared';
import { processLineChanges } from '@/ui/components/shared/diff';
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
    const showDesc = settings.showDescription;
    const isTimestampFocused = !showName && !showVersion;

    const highlightProps = {
        query: searchQuery,
        caseSensitive: isCaseSensitive
    };

    const prefix = viewMode === 'edits' ? 'E' : 'V';

    // Generate preview lines for footer
    // Show preview if:
    // 1. Card is NOT expanded
    // 2. Setting 'showPreview' is true
    // 3. Description is either not shown via settings OR not present on event
    const shouldShowPreview = !isExpanded && settings.showPreview && (!showDesc || !event.toVersionDescription);

    const previewLines = useMemo(() => {
        if (!shouldShowPreview) return null;
        
        const lines = processLineChanges(event.diffData, 'smart');
        const changesOnly = lines.filter((l: any) => l.type === 'add' || l.type === 'remove');
        const preview = changesOnly.slice(0, 3);
        
        if (preview.length === 0) return null;
        
        return preview.map((line: any) => ({
            key: line.key,
            content: line.content,
            type: line.type
        }));
    }, [event.diffData, shouldShowPreview]);

    return (
        <div 
            className={clsx('v-timeline-card', {
                'is-expanded': isExpanded,
                'has-active-match': !!activeMatch
            })} 
            onClick={handleToggle}
        >
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

                    {/* Footer Content Logic */}
                    {!isExpanded && (
                        <>
                            {showDesc && event.toVersionDescription && (
                                <div className="v-timeline-description">
                                    <HighlightedText text={event.toVersionDescription} {...highlightProps} />
                                </div>
                            )}

                            {shouldShowPreview && previewLines && previewLines.length > 0 && (
                                <div className="v-timeline-diff-preview">
                                    {previewLines.map(line => (
                                        <div key={line.key} className={clsx("v-timeline-preview-line", {
                                            "v-preview-add": line.type === 'add',
                                            "v-preview-remove": line.type === 'remove'
                                        })}>
                                            <span className="v-timeline-preview-marker">
                                                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}
                                            </span>
                                            <span className="v-timeline-preview-text">
                                                <HighlightedText text={line.content} {...highlightProps} />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        className="v-timeline-card-diff-container"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="v-timeline-diff-inner">
                            {showDesc && event.toVersionDescription && (
                                <div className="v-timeline-description" style={{ marginBottom: 'var(--size-4-2)' }}>
                                    <HighlightedText text={event.toVersionDescription} {...highlightProps} />
                                </div>
                            )}

                            <div className="v-timeline-diff-content">
                                {renderMode === 'static' ? (
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
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

TimelineEvent.displayName = 'TimelineEvent';
