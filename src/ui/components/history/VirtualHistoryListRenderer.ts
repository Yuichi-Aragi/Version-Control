import { Component, debounce, HTMLElement as ObsidianHTMLElement } from "obsidian";
import { VersionHistoryEntry } from "../../../types";
import { ReadyState } from "../../../state/state";
import { HistoryEntryRenderer } from "./HistoryEntryRenderer";

const RENDER_DEBOUNCE_MS = 20;

/**
 * Manages the rendering of a virtualized list to handle a large number of items
 * efficiently. Only visible items are rendered to the DOM.
 */
export class VirtualHistoryListRenderer extends Component {
    private sizerEl: HTMLElement;
    private renderedNodes: Map<string, HTMLElement> = new Map();
    private visibleNodeIds: Set<string> = new Set();

    private lastScrollTop: number = -1;
    private debouncedUpdate: () => void;
    private totalItemHeight: number;

    constructor(
        private viewportEl: ObsidianHTMLElement,
        private items: VersionHistoryEntry[],
        private itemHeight: number,
        private itemGap: number,
        private entryRenderer: HistoryEntryRenderer,
        private state: ReadyState
    ) {
        super();
        this.sizerEl = this.viewportEl.createDiv('v-history-list-sizer');
        this.debouncedUpdate = debounce(this.update, RENDER_DEBOUNCE_MS, false);
        this.totalItemHeight = this.itemHeight + this.itemGap;
    }

    onload() {
        this.viewportEl.addEventListener('scroll', this.debouncedUpdate);
        
        // Defer initial render until after the next frame to ensure layout is stable
        requestAnimationFrame(() => {
            this.render();
        });

        // Use ResizeObserver to automatically re-render if the viewport size changes
        const resizeObserver = new ResizeObserver(this.debouncedUpdate);
        resizeObserver.observe(this.viewportEl);
        this.register(() => resizeObserver.disconnect());
    }

    onunload() {
        this.viewportEl.removeEventListener('scroll', this.debouncedUpdate);
        this.viewportEl.empty();
        this.renderedNodes.clear();
    }

    /**
     * Updates the list with new items and state, triggering a re-render.
     * @param newItems The new array of items.
     * @param newItemHeight The new height for each item.
     * @param newItemGap The new gap between items.
     * @param newState The new application state.
     */
    public updateItems(newItems: VersionHistoryEntry[], newItemHeight: number, newItemGap: number, newState: ReadyState) {
        this.items = newItems;
        this.itemHeight = newItemHeight;
        this.itemGap = newItemGap;
        this.totalItemHeight = this.itemHeight + this.itemGap;
        this.state = newState;
        this.render();
    }

    private render() {
        this.sizerEl.style.height = `${this.items.length * this.totalItemHeight}px`;
        this.update();
    }

    private update = () => {
        if (!this.viewportEl.isConnected) {
            return;
        }

        const scrollTop = this.viewportEl.scrollTop;
        // No need to check lastScrollTop, as state changes can require a re-render at the same scroll position
        this.lastScrollTop = scrollTop;

        const viewportHeight = this.viewportEl.offsetHeight;
        const buffer = this.totalItemHeight * 2; // Render a few items above and below viewport

        const startIndex = Math.max(0, Math.floor((scrollTop - buffer) / this.totalItemHeight));
        const endIndex = Math.min(this.items.length - 1, Math.ceil((scrollTop + viewportHeight + buffer) / this.totalItemHeight));

        const newVisibleNodeIds = new Set<string>();
        for (let i = startIndex; i <= endIndex; i++) {
            if (this.items[i]) {
                newVisibleNodeIds.add(this.items[i].id);
            }
        }

        // Hide nodes that are no longer visible
        for (const id of this.visibleNodeIds) {
            if (!newVisibleNodeIds.has(id)) {
                const node = this.renderedNodes.get(id);
                if (node) {
                    node.style.display = 'none';
                }
            }
        }

        // Add or update nodes that are now visible
        for (let i = startIndex; i <= endIndex; i++) {
            const item = this.items[i];
            if (!item) continue;

            let node = this.renderedNodes.get(item.id);
            if (node) {
                // Node already exists, update it
                this.entryRenderer.update(node, item, this.state);
                node.style.display = 'flex'; // Use flex to match initial display style
            } else {
                // Node doesn't exist, create it
                node = this.entryRenderer.render(item, this.state);
                this.renderedNodes.set(item.id, node);
                this.viewportEl.appendChild(node);
            }

            // Position the node using `top` and set its height
            node.style.top = `${i * this.totalItemHeight}px`;
            node.style.height = `${this.itemHeight}px`;
        }

        this.visibleNodeIds = newVisibleNodeIds;
    }
}
