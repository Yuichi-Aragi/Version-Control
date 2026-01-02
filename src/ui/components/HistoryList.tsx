import { moment } from 'obsidian';
import { orderBy } from 'es-toolkit';
import clsx from 'clsx';
import { type FC, useEffect, useMemo, memo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppSelector } from '@/ui/hooks';
import { AppStatus } from '@/state';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '@/types';
import { formatFileSize } from '@/ui/utils/dom';
import { HistoryEntry } from '@/ui/components';
import { Icon } from '@/ui/components';
import { useGetVersionHistoryQuery, useGetEditHistoryQuery } from '@/state/apis/history.api';

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
    // Use individual selectors to prevent unnecessary re-renders when unrelated state changes
    const status = useAppSelector(state => state.app.status);
    const noteId = useAppSelector(state => state.app.noteId);
    const viewMode = useAppSelector(state => state.app.viewMode);
    const searchQuery = useAppSelector(state => state.app.searchQuery ?? '');
    const isSearchCaseSensitive = useAppSelector(state => state.app.isSearchCaseSensitive);
    const sortOrder = useAppSelector(state => state.app.sortOrder ?? { property: 'versionNumber', direction: 'desc' });
    const settings = useAppSelector(state => state.app.effectiveSettings);
    
    // Optimization: Only subscribe to whether a panel is open (boolean), not the panel object itself.
    // This prevents re-renders when switching between different panel types (e.g. diff -> settings)
    // if the visual layout of the list (shrunk vs full width) remains the same.
    const isPanelOpen = useAppSelector(state => state.app.panel !== null);

    // RTK Query Hooks
    // We conditionally skip queries if noteId is missing
    const skipQuery = !noteId;
    
    // Pass noteId! because skipQuery handles the null case, but TS needs a string.
    const versionHistoryQuery = useGetVersionHistoryQuery(noteId!, { 
        skip: skipQuery || viewMode !== 'versions' 
    });
    
    const editHistoryQuery = useGetEditHistoryQuery(noteId!, { 
        skip: skipQuery || viewMode !== 'edits' 
    });

    const { data: queryData, isFetching, isLoading } = viewMode === 'versions' ? versionHistoryQuery : editHistoryQuery;

    // Defensive: If noteId is null, force activeList to be undefined/empty to prevent "ghost data"
    // from previous queries persisting when switching to an unregistered note.
    const activeList = noteId ? queryData : undefined;

    // Use isListView from effective settings
    const isListView = settings.isListView;

    // Memoize the processed history to ensure synchronous updates with state changes.
    const processedHistory = useMemo(() => {
        // If loading, we don't process anything, the render logic will show skeletons.
        if (isLoading || isFetching || !activeList) return [];

        const src = Array.isArray(activeList) ? activeList : [];
        const trimmedQuery = String(searchQuery ?? '').trim();

        if (trimmedQuery === '') {
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
            return orderBy(src, [iteratee], [dir]);
        }

        // Search Logic
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
        return sortedByScore.map(item => item.version);

    }, [activeList, isLoading, isFetching, searchQuery, isSearchCaseSensitive, sortOrder, settings]);

    // Notify parent of count changes
    useEffect(() => {
        const total = Array.isArray(activeList) ? activeList.length : 0;
        const filtered = processedHistory.length;
        onCountChange(filtered, total);
    }, [processedHistory.length, activeList, onCountChange]);

    // Unique key to force Virtuoso remount on layout changes
    const listKey = `list-${viewMode}-${isListView ? 'list' : 'card'}`;
    const total = Array.isArray(activeList) ? activeList.length : 0;

    const renderContent = () => {
        // STRICT: If loading, show skeletons.
        if (isLoading || isFetching || status === AppStatus.LOADING) {
            return (
                <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={clsx('v-history-manual-scroll', { 'is-list-view': isListView })}
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
        
        if (processedHistory.length === 0 && String(searchQuery ?? '').trim()) {
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
                    data={processedHistory}
                    itemContent={(_index, version) => {
                        if (!version) return null;
                        return (
                            <motion.div 
                                className={isListView ? 'v-history-item-list-wrapper' : 'v-history-item-card-wrapper'} 
                                data-version-id={String(version.id)}
                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ 
                                    type: "spring", 
                                    stiffness: 500, 
                                    damping: 30,
                                    mass: 1
                                }}
                                style={{ transformOrigin: 'center center' }}
                            >
                                <HistoryEntry 
                                    version={version} 
                                    searchQuery={searchQuery}
                                    isSearchCaseSensitive={isSearchCaseSensitive}
                                    viewMode={viewMode}
                                />
                            </motion.div>
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
        <div className={clsx('v-history-list-container', { 'is-panel-active': isPanelOpen })}>
            <div 
                className={clsx('v-history-list', { 'is-list-view': isListView })}
                style={{ height: '100%', position: 'relative' }}
            >
                <AnimatePresence mode="wait">
                    {renderContent()}
                </AnimatePresence>
            </div>
        </div>
    );
};
