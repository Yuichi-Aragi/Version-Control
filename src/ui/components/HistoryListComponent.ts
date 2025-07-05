import { setIcon, Component, HTMLElement as ObsidianHTMLElement } from "obsidian";
import { Store } from "../../../state/store";
import { ReadyState, VersionControlSettings } from "../../../state/state";
import { VersionHistoryEntry } from "../../../types";
import { getFilteredAndSortedHistory } from "./history/HistoryProcessor";
import { HistoryEntryRenderer } from "./history/HistoryEntryRenderer";
import { renderSkeletonEntry, renderEmptyState } from "./history/HistoryListStates";

/**
 * The main UI component for displaying the list of version history entries.
 * It orchestrates rendering but delegates data processing and item rendering
 * to specialized modules.
 */
export class HistoryListComponent extends Component {
    private container: ObsidianHTMLElement;
    private listEl: ObsidianHTMLElement | null = null;
    private countEl: ObsidianHTMLElement | null = null;
    private store: Store;
    private entryRenderer: HistoryEntryRenderer;

    private processedHistory: VersionHistoryEntry[] = [];

    constructor(parent: ObsidianHTMLElement, store: Store) {
        super();
        this.container = parent.createDiv("v-history-list-container");
        this.store = store;
        // The renderer is instantiated here and passed the store.
        this.entryRenderer = new HistoryEntryRenderer(store);
        this.container.hide();
    }

    /**
     * Renders the entire history list based on the current application state.
     * @param state The current ReadyState of the application.
     */
    render(state: ReadyState): void {
        const newProcessedHistory = getFilteredAndSortedHistory(state);

        const viewModeChanged = this.listEl && (this.listEl.classList.contains('is-list-view') !== state.settings.isListView);
        const historyIdsChanged = !this.processedHistory || this.processedHistory.map(v => v.id).join(',') !== newProcessedHistory.map(v => v.id).join(',');

        if (viewModeChanged || historyIdsChanged) {
            // A full rebuild is needed if the list of items or the view mode has changed.
            this.processedHistory = newProcessedHistory;
            this.rebuildList(state);
        } else {
            // A soft update is sufficient if only item content (name, highlight) has changed.
            this.processedHistory = newProcessedHistory;
            this.updateExistingEntries(state);
        }

        this.updateCountDisplay(this.processedHistory.length, state.history.length);
        this.container.show();
    }

    /**
     * Renders the list in a loading state with skeleton placeholders.
     * @param settings The current plugin settings to determine the view mode.
     */
    renderAsLoading(settings: VersionControlSettings): void {
        this.container.empty();
        this.buildSkeletonDOM(null);
        this.listEl!.classList.toggle('is-list-view', settings.isListView);
        this.updateCountDisplay("Loading...");

        if (this.listEl) {
            for (let i = 0; i < 5; i++) { 
                renderSkeletonEntry(this.listEl, settings.isListView);
            }
        }
        this.container.show();
    }
    
    /**
     * Builds the static parts of the list DOM (header, container).
     * @param state The current ReadyState, or null if loading.
     */
    private buildSkeletonDOM(state: ReadyState | null): void {
        const header = this.container.createDiv("v-history-header");
        setIcon(header, "history");
        header.createSpan({ text: " Version History" });
        this.countEl = header.createSpan("v-history-count");
        
        this.listEl = this.container.createDiv("v-history-list");
        if (state && this.listEl) { 
            this.listEl.classList.toggle('is-list-view', state.settings.isListView);
        }
    }

    /**
     * Performs a full rebuild of the list, clearing and re-populating all items.
     * @param state The current ReadyState.
     */
    private rebuildList(state: ReadyState): void {
        this.container.empty();
        this.buildSkeletonDOM(state);

        if (this.processedHistory.length === 0) {
            // This handles the case where a search query returns no results.
            renderEmptyState(this.listEl!, "search-x", "No matching versions found.", `Try a different search query or change sort options.`);
            return;
        }

        // Suppress entry animations during a full rebuild to prevent jank.
        this.listEl!.addClass('is-rebuilding');

        const fragment = document.createDocumentFragment();
        for (const version of this.processedHistory) {
            try {
                this.entryRenderer.render(fragment, version, state);
            } catch (error) {
                console.error("VC: Failed to render a history entry.", { entry: version, error });
                this.entryRenderer.renderErrorEntry(fragment, version);
            }
        }
        this.listEl!.appendChild(fragment);

        // Re-enable animations after the DOM has settled.
        setTimeout(() => this.listEl?.removeClass('is-rebuilding'), 50);
    }

    /**
     * Updates existing DOM elements in place without a full rebuild.
     * @param state The current ReadyState.
     */
    private updateExistingEntries(state: ReadyState): void {
        if (!this.listEl) return;

        const entryElements = this.listEl.children;
        for (let i = 0; i < entryElements.length; i++) {
            const el = entryElements[i] as HTMLElement;
            const versionId = el.dataset.versionId;
            if (!versionId) continue;

            const versionData = this.processedHistory.find(v => v.id === versionId);
            if (!versionData) {
                el.remove();
                continue;
            }

            const isNamingThisVersion = versionData.id === state.namingVersionId;
            const isExpanded = state.expandedTagIds.includes(versionId);
            const newSignature = `${versionData.name || ''}|${(versionData.tags || []).join(',')}|${isNamingThisVersion}|${isExpanded}`;

            if (el.dataset.signature !== newSignature) {
                // If the signature has changed, the element needs a full re-render.
                // Use a fragment to correctly replace the node.
                const fragment = document.createDocumentFragment();
                this.entryRenderer.render(fragment, versionData, state);
                el.replaceWith(fragment);
            } else {
                // Otherwise, just toggle the highlight class.
                el.classList.toggle('is-highlighted', versionData.id === state.highlightedVersionId);
            }
        }
        
        this.listEl.classList.toggle('hide-timestamps', !state.settings.showTimestamps);
    }

    private updateCountDisplay(shown: number | string, total?: number): void {
        if (this.countEl) {
            if (typeof shown === 'string') {
                this.countEl.setText(shown);
            } else if (total !== undefined && shown !== total) {
                this.countEl.setText(`${shown} of ${total} versions`);
            } else {
                this.countEl.setText(`${shown} ${shown === 1 ? 'version' : 'versions'}`);
            }
        }
    }
    
    public getContainer(): ObsidianHTMLElement {
        return this.container;
    }

    onunload(): void {
        this.container.remove();
    }
}
