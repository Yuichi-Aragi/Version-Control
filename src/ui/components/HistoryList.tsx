import { moment } from 'obsidian';
import { orderBy } from 'lodash-es';
import clsx from 'clsx';
import { type FC, useEffect, useState, useTransition } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '../../types';
import { formatFileSize } from '../utils/dom';
import { HistoryEntry } from './HistoryEntry';
import { Icon } from './Icon';

const LIST_ITEM_HEIGHT = 44;
const CARD_ITEM_HEIGHT = 110;
const CARD_ITEM_GAP = 8;

const SkeletonEntry: FC<{ isListView: boolean }> = ({ isListView }) => (
    <div className={clsx('v-history-entry', 'is-skeleton', { 'is-list-view': isListView })}>
        {isListView ? (
            <div className="v-entry-header">
                <div className="v-version-id v-skeleton-item" />
                <div className="v-entry-main-info">
                    <div className="v-version-name v-skeleton-item" />
                </div>
                <div className="v-version-timestamp v-skeleton-item" />
            </div>
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
);

const EmptyState: FC<{ icon: string; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
    <div className="v-empty-state">
        <div className="v-empty-state-icon"><Icon name={icon} /></div>
        <p className="v-empty-state-title">{title}</p>
        {subtitle && <p className="v-empty-state-subtitle v-meta-label">{subtitle}</p>}
    </div>
);

export const HistoryList: FC = () => {
    const { status, history, searchQuery, isSearchCaseSensitive, sortOrder, isListView, panel, settings } = useAppSelector(state => ({
        status: state.status,
        history: state.history,
        searchQuery: state.searchQuery,
        isSearchCaseSensitive: state.isSearchCaseSensitive,
        sortOrder: state.sortOrder,
        isListView: state.settings.isListView,
        panel: state.panel,
        settings: state.settings,
    }));

    const [processedHistory, setProcessedHistory] = useState<VersionHistoryEntryType[]>([]);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        if (status !== AppStatus.READY) {
            setProcessedHistory([]);
            return;
        }

        startTransition(() => {
            let filtered = [...history];
            if (searchQuery.trim() !== '') {
                const query = searchQuery.trim();
                filtered = filtered.filter(v => {
                    const searchableString = [`V${v.versionNumber}`, v.name || '', (moment as any)(v.timestamp).fromNow(true), (moment as any)(v.timestamp).format("LLLL"), formatFileSize(v.size)].join(' ');
                    return isSearchCaseSensitive ? searchableString.includes(query) : searchableString.toLowerCase().includes(query.toLowerCase());
                });
            }
            const iteratee = (v: VersionHistoryEntryType): string | number | Date => {
                switch (sortOrder.property) {
                    case 'name': return v.name?.toLowerCase() || '\uffff';
                    case 'size': return v.size;
                    case 'timestamp': return new Date(v.timestamp);
                    case 'versionNumber':
                        return v.versionNumber;
                    default:
                        return v.versionNumber;
                }
            };
            const result = orderBy(filtered, [iteratee], [sortOrder.direction]);
            setProcessedHistory(result);
        });
    }, [status, history, searchQuery, isSearchCaseSensitive, sortOrder]);


    const getCountText = () => {
        if (status === AppStatus.LOADING) return "Loading...";
        if (processedHistory.length !== history.length) {
            return `${processedHistory.length} of ${history.length} versions`;
        }
        return `${history.length} ${history.length === 1 ? 'version' : 'versions'}`;
    };

    if (status === AppStatus.LOADING) {
        return (
            <div className="v-history-list-container">
                <div className="v-history-header">
                    <Icon name="history" />
                    <span> Version history</span>
                    <span className="v-history-count">{getCountText()}</span>
                </div>
                <div className={clsx('v-history-list', { 'is-list-view': settings.isListView })}>
                    {Array.from({ length: 8 }).map((_, i) => <SkeletonEntry key={i} isListView={settings.isListView} />)}
                </div>
            </div>
        );
    }

    if (status !== AppStatus.READY) return null;

    const itemHeight = isListView ? LIST_ITEM_HEIGHT : (CARD_ITEM_HEIGHT + CARD_ITEM_GAP);

    const renderContent = () => {
        if (history.length === 0) {
            return <EmptyState icon="inbox" title="No versions saved yet." subtitle="Click the 'Save new version' button to start tracking history for this note." />;
        }
        if (processedHistory.length === 0 && searchQuery.trim()) {
            return <EmptyState icon="search-x" title="No matching versions found." subtitle="Try a different search query or change sort options." />;
        }
        return (
            <Virtuoso
                key={isListView ? 'list' : 'card'}
                className="v-virtuoso-container"
                data={processedHistory}
                fixedItemHeight={itemHeight}
                itemContent={(_index, version) => (
                    <div className={isListView ? undefined : "v-history-item-card-wrapper"}>
                        <HistoryEntry version={version} />
                    </div>
                )}
            />
        );
    };

    return (
        <div className={clsx('v-history-list-container', { 'is-panel-active': panel !== null })}>
            <div className="v-history-header">
                <Icon name="history" />
                <span> Version history</span>
                <span className="v-history-count">{getCountText()}</span>
            </div>
            <div className={clsx('v-history-list', { 'is-list-view': isListView, 'is-searching-bg': isPending })}>
                {renderContent()}
            </div>
        </div>
    );
};
