import { moment } from 'obsidian';
import { orderBy } from 'es-toolkit';
import clsx from 'clsx';
import { type FC, useEffect, useRef, useState, useTransition, memo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
import type { VersionHistoryEntry as VersionHistoryEntryType, ViewMode } from '@/types';
import { formatFileSize } from '@/ui/utils/dom';
import { HistoryEntry } from '@/ui/components';
import { Icon } from '@/ui/components';

const SkeletonEntry: FC<{ isListView: boolean }> = memo(({ isListView }) => (
    <motion.div 
        className={clsx('v-history-entry', 'is-skeleton', { 'is-list-view': isListView })} 
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
    >
        {isListView ? (
            <>
                <div className="v-entry-header">
                    <div className="v-version-id v-skeleton-item" />
                    <div className="v-entry-main-info">
                        <div className="v-version-name v-skeleton-item" />
                    </div>
                    <div className="v-version-timestamp v-skeleton-item" />
                </div>
                <div className="v-version-content v-skeleton-item" />
            </>
        ) : (
            <>
                <div className="v-entry-header">
                    <div className="v-version-id v-skeleton-item" />
                    <div className="v-version-name v-skeleton-item" />
                    <div className="v-version-timestamp v-skeleton-item" />
                </div>
                <div className="v-version-content v-skeleton-item" />
            </>
        )}
    </motion.div>
));
SkeletonEntry.displayName = 'SkeletonEntry';

const EmptyState: FC<{ icon: string; title: string; subtitle?: string }> = memo(({ icon, title, subtitle }) => (
    <motion.div 
        className="v-empty-state" 
        role="status" 
        aria-live="polite"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
    >
        <div className="v-empty-state-icon"><Icon name={icon} /></div>
        <p className="v-empty-state-title">{title}</p>
        {subtitle && <p className="v-empty-state-subtitle v-meta-label">{subtitle}</p>}
    </motion.div>
));
EmptyState.displayName = 'EmptyState';

/** Safe wrapper for moment: don't allow exceptions bubbling up. */
function safeFormatTimestamp(raw: unknown, formatStr = 'LLLL'): string {
    try {
        // moment may throw if value invalid
        return (moment as any)(raw).format(formatStr);
    } catch {
        try {
            // fallback to using Date toISOString
            const d = new Date(String(raw));
            if (!Number.isNaN(d.getTime())) return d.toISOString();
        } catch {
            /* swallow */
        }
        return '';
    }
}

interface HistoryListProps {
    onCountChange: (filteredCount: number, totalCount: number) => void;
}

/** Main list component */
export const HistoryList: FC<HistoryListProps> = ({ onCountChange }) => {
    const { 
        status, 
        history, 
        editHistory,
        viewMode,
        searchQuery, 
        isSearchCaseSensitive, 
        sortOrder, 
        panel, 
        settings, // Effective settings
    } = useAppSelector(state => ({
        status: state.status,
        history: state.history ?? [],
        editHistory: state.editHistory ?? [],
        viewMode: state.viewMode,
        searchQuery: state.searchQuery ?? '',
        isSearchCaseSensitive: state.isSearchCaseSensitive,
        sortOrder: state.sortOrder ?? { property: 'versionNumber', direction: 'desc' },
        panel: state.panel,
        settings: state.effectiveSettings,
    }));

    const [processedHistory, setProcessedHistory] = useState<VersionHistoryEntryType[]>([]);
    // Track the viewMode for which the current processedHistory is valid
    const [processedMode, setProcessedMode] = useState<ViewMode>(viewMode);
    // Track initial load to prevent flash of empty state before first processing
    const [isFirstLoad, setIsFirstLoad] = useState(true);
    const [isPending, startTransition] = useTransition();

    // Determine active list based on mode
    const activeList = viewMode === 'versions' ? history : editHistory;
    // Use isListView from effective settings
    const isListView = settings.isListView;

    const isMountedRef = useRef<boolean>(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Strict reset when status changes to LOADING to prevent stale data
    useEffect(() => {
        if (status === AppStatus.LOADING) {
            setProcessedHistory([]);
            onCountChange(0, 0);
            setIsFirstLoad(true);
        }
    }, [status, onCountChange]);

    useEffect(() => {
        if (status !== AppStatus.READY) {
            if (status !== AppStatus.LOADING) {
                setProcessedHistory([]);
                onCountChange(0, activeList.length);
            }
            return;
        }

        let isCancelled = false;

        startTransition(() => {
            try {
                const src = Array.isArray(activeList) ? activeList : [];
                const trimmedQuery = String(searchQuery ?? '').trim();

                let result = src;

                if (trimmedQuery !== '') {
                    const query = isSearchCaseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();

                    // Calculate score for each item
                    const scored = src.map(v => {
                        let score = 0;
                        const versionId = `V${v.versionNumber ?? ''}`;
                        const name = String(v.name ?? '');
                        const description = String(v.description ?? '');
                        
                        const size = formatFileSize(typeof v.size === 'number' ? v.size : 0);
                        
                        const timestampStr = settings.useRelativeTimestamps 
                            ? (() => { try { return (moment as any)(v.timestamp).fromNow(true); } catch { return ''; } })()
                            : safeFormatTimestamp(v.timestamp, 'LLLL');

                        const wordCount = settings.enableWordCount 
                            ? String(settings.includeMdSyntaxInWordCount ? v.wordCountWithMd : v.wordCount) 
                            : '';
                        const charCount = settings.enableCharacterCount
                            ? String(settings.includeMdSyntaxInCharacterCount ? v.charCountWithMd : v.charCount)
                            : '';
                        const lineCount = settings.enableLineCount
                            ? String(settings.includeMdSyntaxInLineCount ? v.lineCount : v.lineCountWithoutMd)
                            : '';

                        const check = (val: string) => isSearchCaseSensitive ? val : val.toLowerCase();
                        const q = query;

                        if (check(versionId) === q) score += 100;
                        else if (check(versionId).includes(q)) score += 80;

                        if (check(name).startsWith(q)) score += 60;
                        else if (check(name).includes(q)) score += 50;

                        if (check(description).includes(q)) score += 40;

                        if (check(size).includes(q)) score += 20;
                        if (check(timestampStr).includes(q)) score += 20;
                        
                        if (wordCount && check(wordCount) === q) score += 15;
                        if (charCount && check(charCount) === q) score += 15;
                        if (lineCount && check(lineCount) === q) score += 15;

                        return { version: v, score };
                    });

                    const filteredScored = scored.filter(item => item.score > 0);
                    const sortedByScore = orderBy(filteredScored, ['score'], ['desc']);
                    result = sortedByScore.map(item => item.version);

                } else {
                    const iteratee = (v: VersionHistoryEntryType): string | number => {
                        const prop = sortOrder?.property ?? 'versionNumber';
                        switch (prop) {
                            case 'name':
                                return (String(v.name ?? '').toLowerCase()) || '\uffff';
                            case 'size':
                                return typeof v.size === 'number' ? v.size : 0;
                            case 'timestamp': {
                                const ms = (() => {
                                    const t = v.timestamp;
                                    const parsed = Number(new Date(String(t)));
                                    return Number.isFinite(parsed) ? parsed : 0;
                                })();
                                return ms;
                            }
                            case 'versionNumber':
                            default:
                                const num = Number((v as any).versionNumber);
                                return Number.isFinite(num) ? num : 0;
                        }
                    };

                    const dir = sortOrder?.direction === 'asc' ? 'asc' : 'desc';
                    result = orderBy(src, [iteratee], [dir]);
                }

                if (isMountedRef.current && !isCancelled) {
                    setProcessedHistory(result);
                    setProcessedMode(viewMode);
                    setIsFirstLoad(false);
                    onCountChange(result.length, src.length);
                }
            } catch (err) {
                console.error('HistoryList: failed to process history:', err);
                if (isMountedRef.current && !isCancelled) {
                    setProcessedHistory([]);
                    setProcessedMode(viewMode);
                    setIsFirstLoad(false);
                    onCountChange(0, activeList.length);
                }
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [status, activeList, searchQuery, isSearchCaseSensitive, sortOrder, startTransition, onCountChange, settings, viewMode]);

    const isDataStale = viewMode !== processedMode;
    const total = Array.isArray(activeList) ? activeList.length : 0;

    // Unique key to force Virtuoso remount on layout changes
    const listKey = `list-${viewMode}-${isListView ? 'list' : 'card'}`;

    const renderContent = () => {
        if (status === AppStatus.LOADING || isDataStale || (isFirstLoad && total > 0)) {
            return (
                <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={clsx('v-history-list', { 'is-list-view': isListView })}
                >
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className={isListView ? 'v-history-item-list-wrapper' : 'v-history-item-card-wrapper'}>
                            <SkeletonEntry isListView={isListView} />
                        </div>
                    ))}
                </motion.div>
            );
        }

        if (status !== AppStatus.READY) return null;

        if (total === 0) {
            const noun = viewMode === 'versions' ? 'versions' : 'edits';
            const action = viewMode === 'versions' ? 'track history' : 'track edits';
            return (
                <EmptyState 
                    key="empty" 
                    icon="inbox" 
                    title={`No ${noun} saved yet.`} 
                    subtitle={`Click the '+' button to start ${action} for this note.`} 
                />
            );
        }
        
        if ((Array.isArray(processedHistory) ? processedHistory.length : 0) === 0 && String(searchQuery ?? '').trim()) {
            return (
                <EmptyState 
                    key="no-results" 
                    icon="search-x" 
                    title="No matching items found." 
                    subtitle="Try a different search query or change sort options." 
                />
            );
        }

        return (
            <motion.div 
                key={listKey}
                className="v-virtuoso-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ height: '100%', width: '100%' }}
            >
                <Virtuoso
                    style={{ height: '100%' }}
                    className="v-virtuoso-container"
                    data={processedHistory ?? []}
                    itemContent={(_index, version) => {
                        if (!version) return null;
                        return (
                            <div className={isListView ? 'v-history-item-list-wrapper' : 'v-history-item-card-wrapper'} data-version-id={String(version.id)}>
                                <HistoryEntry 
                                    version={version} 
                                    searchQuery={searchQuery}
                                    isSearchCaseSensitive={isSearchCaseSensitive}
                                    viewMode={viewMode}
                                />
                            </div>
                        );
                    }}
                    components={{
                        ScrollSeekPlaceholder: ({ height }: { height: number }) => (
                            <div style={{ height }} aria-hidden />
                        ),
                    }}
                />
            </motion.div>
        );
    };

    return (
        <div className={clsx('v-history-list-container', { 'is-panel-active': panel !== null })}>
            <div 
                className={clsx('v-history-list', { 'is-list-view': isListView, 'is-searching-bg': isPending && !isDataStale })}
                style={{ height: '100%', position: 'relative' }}
            >
                <AnimatePresence mode="wait">
                    {renderContent()}
                </AnimatePresence>
            </div>
        </div>
    );
};
