// src/ui/components/HistoryList.tsx
import { moment } from 'obsidian';
import { orderBy } from 'lodash-es';
import clsx from 'clsx';
import { type FC, useEffect, useMemo, useRef, useState, useTransition, memo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../types';
import { formatFileSize } from '../utils/dom';
import { HistoryEntry } from './HistoryEntry';
import { Icon } from './Icon';

/** Layout constants — kept local and immutable. */
const LIST_ITEM_HEIGHT = 64;
const LIST_ITEM_GAP = 4;
const CARD_ITEM_HEIGHT = 110;
const CARD_ITEM_GAP = 8;

const SkeletonEntry: FC<{ isListView: boolean }> = memo(({ isListView }) => (
    <div className={clsx('v-history-entry', 'is-skeleton', { 'is-list-view': isListView })} aria-hidden>
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
    </div>
));
SkeletonEntry.displayName = 'SkeletonEntry';

const EmptyState: FC<{ icon: string; title: string; subtitle?: string }> = memo(({ icon, title, subtitle }) => (
    <div className="v-empty-state" role="status" aria-live="polite">
        <div className="v-empty-state-icon"><Icon name={icon} /></div>
        <p className="v-empty-state-title">{title}</p>
        {subtitle && <p className="v-empty-state-subtitle v-meta-label">{subtitle}</p>}
    </div>
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
    const { status, history, searchQuery, isSearchCaseSensitive, sortOrder, isListView, panel, settings } = useAppSelector(state => ({
        status: state.status,
        history: state.history ?? [],
        searchQuery: state.searchQuery ?? '',
        isSearchCaseSensitive: state.isSearchCaseSensitive,
        sortOrder: state.sortOrder ?? { property: 'versionNumber', direction: 'desc' },
        isListView: state.settings?.isListView ?? true,
        panel: state.panel,
        settings: state.settings ?? { isListView: true, useRelativeTimestamps: true },
    }));

    const [processedHistory, setProcessedHistory] = useState<VersionHistoryEntryType[]>([]);
    const [isPending, startTransition] = useTransition();

    const isMountedRef = useRef<boolean>(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (status !== AppStatus.READY) {
            setProcessedHistory([]);
            onCountChange(0, history.length);
            return;
        }

        startTransition(() => {
            try {
                const src = Array.isArray(history) ? history : [];
                const trimmedQuery = String(searchQuery ?? '').trim();

                let filtered = src;

                if (trimmedQuery !== '') {
                    const query = isSearchCaseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();

                    filtered = src.filter(v => {
                        try {
                            const versionId = `V${v.versionNumber ?? ''}`;
                            const name = String(v.name ?? '');
                            const timestampFromNow = (() => {
                                try {
                                    return (moment as any)(v.timestamp).fromNow(true);
                                } catch {
                                    return '';
                                }
                            })();
                            const timestampFull = safeFormatTimestamp(v.timestamp, 'LLLL');
                            const size = formatFileSize(typeof v.size === 'number' ? v.size : 0);

                            const searchableString = [versionId, name, timestampFromNow, timestampFull, size].join(' ');
                            return isSearchCaseSensitive ? searchableString.includes(query) : searchableString.toLowerCase().includes(query);
                        } catch (err) {
                            return false;
                        }
                    });
                }

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

                const result = orderBy(filtered, [iteratee], [dir]);

                if (isMountedRef.current) {
                    setProcessedHistory(result);
                    onCountChange(result.length, src.length);
                }
            } catch (err) {
                console.error('HistoryList: failed to process history:', err);
                if (isMountedRef.current) {
                    setProcessedHistory([]);
                    onCountChange(0, history.length);
                }
            }
        });
    }, [status, history, searchQuery, isSearchCaseSensitive, sortOrder, startTransition, onCountChange]);

    const itemHeight = useMemo(() => (isListView ? (LIST_ITEM_HEIGHT + LIST_ITEM_GAP) : (CARD_ITEM_HEIGHT + CARD_ITEM_GAP)), [isListView]);

    if (status === AppStatus.LOADING) {
        return (
            <div className="v-history-list-container">
                <div className={clsx('v-history-list', { 'is-list-view': settings.isListView })}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className={settings.isListView ? 'v-history-item-list-wrapper' : 'v-history-item-card-wrapper'}>
                            <SkeletonEntry isListView={settings.isListView} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (status !== AppStatus.READY) return null;

    const renderContent = () => {
        const total = Array.isArray(history) ? history.length : 0;
        if (total === 0) {
            return <EmptyState icon="inbox" title="No versions saved yet." subtitle="Click the '+' button to start tracking history for this note." />;
        }
        if ((Array.isArray(processedHistory) ? processedHistory.length : 0) === 0 && String(searchQuery ?? '').trim()) {
            return <EmptyState icon="search-x" title="No matching versions found." subtitle="Try a different search query or change sort options." />;
        }

        return (
            <Virtuoso
                key={isListView ? 'list' : 'card'}
                className="v-virtuoso-container"
                data={processedHistory ?? []}
                fixedItemHeight={Number(itemHeight) || LIST_ITEM_HEIGHT}
                itemContent={(_index, version) => {
                    if (!version) return null;
                    return (
                        <div className={isListView ? 'v-history-item-list-wrapper' : 'v-history-item-card-wrapper'} data-version-id={String(version.id)}>
                            <HistoryEntry version={version} />
                        </div>
                    );
                }}
                components={{
                    ScrollSeekPlaceholder: ({ height }) => (
                        <div style={{ height }} aria-hidden />
                    ),
                }}
            />
        );
    };

    return (
        <div className={clsx('v-history-list-container', { 'is-panel-active': panel !== null })}>
            <div className={clsx('v-history-list', { 'is-list-view': isListView, 'is-searching-bg': isPending })}>
                {renderContent()}
            </div>
        </div>
    );
};
