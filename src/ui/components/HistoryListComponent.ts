import { setIcon, Component } from "obsidian";
import type { AppStore } from "../../state/store";
import { AppStatus } from "../../state/state";
import type { AppState } from "../../state/state";
import type { VersionHistoryEntry, VersionControlSettings } from "../../types";
import { getFilteredAndSortedHistory } from "./history/HistoryProcessor";
import { HistoryEntryRenderer } from "./history/HistoryEntryRenderer";
import { renderSkeletonEntry, renderEmptyState } from "./history/HistoryListStates";
import { VirtualHistoryListRenderer } from "./history/VirtualHistoryListRenderer";

const LIST_ITEM_HEIGHT = 44;
const CARD_ITEM_HEIGHT = 110; // Reduced from 140 after removing tags
const CARD_ITEM_GAP = 8;      // Explicit gap between cards
const TIMESTAMP_UPDATE_INTERVAL = 5000; // 5 seconds

export class HistoryListComponent extends Component {
    private container: HTMLElement;
    private listViewport: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;
    private entryRenderer: HistoryEntryRenderer;
    private virtualRenderer: VirtualHistoryListRenderer | null = null;
    private timestampUpdateInterval: number | null = null;

    private lastProcessedIds: string = "";
    // FIX: Changed from `boolean | null` to `boolean | undefined`. This resolves
    // a type error where `null` is not assignable to an optional boolean parameter
    // that expects `boolean | undefined`. `undefined` is the correct type for a
    // "not yet set" state in this context.
    private lastViewMode: boolean | undefined;
    private lastPanelIsOpen: boolean | undefined;

    constructor(parent: HTMLElement, store: AppStore) {
        super();
        this.container = parent.createDiv("v-history-list-container");
        this.entryRenderer = new HistoryEntryRenderer(store);
        this.buildSkeletonDOM(); // Build static elements once.
        this.container.hide();
    }

    render(state: AppState): void {
        if (state.status !== AppStatus.READY) {
            this.container.hide();
            this.stopTimestampUpdates();
            return;
        }

        const isPanelOpen = state.panel !== null;
        this.container.classList.toggle('is-panel-active', isPanelOpen);

        const newProcessedHistory = getFilteredAndSortedHistory(state);
        const newProcessedIds = newProcessedHistory.map(v => v.id).join(',');
        const newViewMode = state.settings.isListView;

        // Determine if a full re-initialization of the virtual list is needed.
        // A check for panel open/close state ensures event handlers are
        // correctly re-attached or removed when the panel's visibility changes.
        const needsRebuild = this.lastProcessedIds !== newProcessedIds || 
                             this.lastViewMode !== newViewMode || 
                             this.lastPanelIsOpen !== isPanelOpen || 
                             !this.virtualRenderer;

        const itemHeight = state.settings.isListView ? LIST_ITEM_HEIGHT : CARD_ITEM_HEIGHT;
        const itemGap = state.settings.isListView ? 0 : CARD_ITEM_GAP;

        if (needsRebuild) {
            this.rebuildList(state, newProcessedHistory);
        } else {
            // If only state changed (e.g., naming, highlighting), just update the items
            this.virtualRenderer?.updateItems(newProcessedHistory, itemHeight, itemGap, state);
        }

        this.lastProcessedIds = newProcessedIds;
        this.lastViewMode = newViewMode;
        this.lastPanelIsOpen = isPanelOpen;

        this.updateCountDisplay(newProcessedHistory.length, state.history.length);
        this.container.show();
        this.startTimestampUpdates();
    }

    renderAsLoading(settings: VersionControlSettings): void {
        this.destroyVirtualRenderer();
        this.stopTimestampUpdates();
        
        if (!this.listViewport) return; // Safety check
        this.listViewport.empty(); // Only clear the list area

        this.updateCountDisplay("Loading...");

        this.listViewport.classList.toggle('is-list-view', settings.isListView);
        for (let i = 0; i < 8; i++) {
            renderSkeletonEntry(this.listViewport, settings.isListView);
        }
        
        this.container.show();
    }

    private rebuildList(state: AppState, processedHistory: VersionHistoryEntry[]): void {
        this.destroyVirtualRenderer();
        
        if (!this.listViewport) return;
        this.listViewport.empty(); // Only clear the list area

        if (processedHistory.length === 0) {
            renderEmptyState(this.listViewport, "search-x", "No matching versions found.", `Try a different search query or change sort options.`);
            return;
        }

        const itemHeight = state.settings.isListView ? LIST_ITEM_HEIGHT : CARD_ITEM_HEIGHT;
        const itemGap = state.settings.isListView ? 0 : CARD_ITEM_GAP;
        this.virtualRenderer = this.addChild(
            new VirtualHistoryListRenderer(this.listViewport, processedHistory, itemHeight, itemGap, this.entryRenderer, state)
        );
    }

    private buildSkeletonDOM(): void {
        const header = this.container.createDiv("v-history-header");
        setIcon(header, "history");
        header.createSpan({ text: " Version History" });
        this.countEl = header.createSpan("v-history-count");
        this.listViewport = this.container.createDiv("v-history-list");
    }

    private updateCountDisplay(shown: number, total: number): void;
    private updateCountDisplay(message: string): void;
    private updateCountDisplay(shownOrMessage: number | string, total?: number): void {
        if (this.countEl) {
            if (typeof shownOrMessage === 'string') {
                this.countEl.setText(shownOrMessage);
            } else if (total !== undefined && shownOrMessage !== total) {
                this.countEl.setText(`${shownOrMessage} of ${total} versions`);
            } else {
                this.countEl.setText(`${shownOrMessage} ${shownOrMessage === 1 ? 'version' : 'versions'}`);
            }
        }
    }

    private startTimestampUpdates(): void {
        if (this.timestampUpdateInterval) return;
        this.timestampUpdateInterval = window.setInterval(() => {
            this.virtualRenderer?.updateVisibleItems();
        }, TIMESTAMP_UPDATE_INTERVAL);
    }

    private stopTimestampUpdates(): void {
        if (this.timestampUpdateInterval) {
            window.clearInterval(this.timestampUpdateInterval);
            this.timestampUpdateInterval = null;
        }
    }

    private destroyVirtualRenderer(): void {
        if (this.virtualRenderer) {
            this.removeChild(this.virtualRenderer);
            this.virtualRenderer = null;
        }
    }

    public getContainer(): HTMLElement {
        return this.container;
    }

    override onunload(): void {
        this.destroyVirtualRenderer();
        this.stopTimestampUpdates();
        this.container.remove();
    }
}
