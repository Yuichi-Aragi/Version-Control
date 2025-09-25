import React, { useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { VersionHistoryEntry } from '../../../../types';
import type { AppState } from '../../../../state/state';
import type { HistoryEntryRenderer } from '../HistoryEntryRenderer';
import { HistoryEntryComponent } from './HistoryEntryComponent';

const LIST_ITEM_HEIGHT = 44;
const CARD_ITEM_HEIGHT = 110;
const CARD_ITEM_GAP = 8;

interface VirtualizedHistoryListComponentProps {
    items: VersionHistoryEntry[];
    state: AppState;
    entryRenderer: HistoryEntryRenderer;
}

/**
 * A React component that uses React Virtuoso to render a virtualized list of history items.
 * It calculates item heights and uses a bridge component (HistoryEntryComponent) to render
 * each item using the existing vanilla TypeScript rendering logic.
 */
export const VirtualizedHistoryListComponent = ({ items, state, entryRenderer }: VirtualizedHistoryListComponentProps) => {
    const isListView = state.settings.isListView;
    const itemHeight = isListView ? LIST_ITEM_HEIGHT : (CARD_ITEM_HEIGHT + CARD_ITEM_GAP);

    /**
     * Memoized callback for rendering each item in the virtualized list.
     * This is passed to Virtuoso's `itemContent` prop.
     * `useCallback` is crucial for performance to prevent Virtuoso from re-rendering
     * all visible items on every parent render.
     */
    const renderItem = useCallback((_index: number, version: VersionHistoryEntry) => {
        // This outer div handles the gap between items in card view.
        // Virtuoso positions this div, and the inner component renders the content.
        return (
            <div className={isListView ? undefined : "v-history-item-card-wrapper"}>
                <HistoryEntryComponent
                    version={version}
                    state={state}
                    entryRenderer={entryRenderer}
                />
            </div>
        );
    }, [state, entryRenderer, isListView]); // Dependencies ensure the callback is updated only when necessary.

    return (
        <Virtuoso
            className="v-virtuoso-container"
            data={items}
            fixedItemHeight={itemHeight}
            itemContent={renderItem}
        />
    );
};

// Set a display name for easier debugging in React DevTools.
VirtualizedHistoryListComponent.displayName = 'VirtualizedHistoryListComponent';