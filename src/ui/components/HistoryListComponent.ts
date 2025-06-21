import { setIcon, moment, HTMLElement } from "obsidian";
import { VersionHistoryEntry } from "../../types";
import { formatFileSize } from "../utils/dom";
import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";
import { versionActions, showVersionContextMenu } from "../VersionActions";

export class HistoryListComponent {
    private container: HTMLElement;
    private listEl: HTMLElement;
    private countEl: HTMLElement;
    private plugin: VersionControlPlugin;

    private history: VersionHistoryEntry[] = [];
    private isListView: boolean | null = null;
    private displayedCount = 0;
    private readonly PAGE_SIZE = 30;
    private observer: IntersectionObserver | null = null;

    constructor(parent: HTMLElement, plugin: VersionControlPlugin) {
        this.container = parent.createDiv("v-history-list-container");
        this.plugin = plugin;
    }

    render(state: AppState) {
        const { activeNote, settings } = state;
        
        // Re-render the whole list if the history array OR the list view mode has changed.
        // This is a key fix to ensure event listeners are correctly managed.
        if (this.history !== activeNote.history || this.isListView !== settings.isListView) {
            this.history = activeNote.history;
            this.isListView = settings.isListView;
            this.displayedCount = 0;
            this.observer?.disconnect();
            this.container.empty();

            const header = this.container.createDiv("v-history-header");
            setIcon(header, "history");
            header.createSpan({ text: " Version History" });
            this.countEl = header.createSpan("v-history-count");
            
            this.listEl = this.container.createDiv("v-history-list");

            const totalCount = this.history.length;
            this.countEl.setText(`${totalCount} ${totalCount === 1 ? 'version' : 'versions'}`);
            
            if (activeNote.isLoadingHistory) {
                this.renderSkeleton();
                return;
            }
            
            if (totalCount === 0) {
                this.renderEmptyState("inbox", "No versions saved yet.", "Click 'Save New Version' to begin.");
                return;
            }
            
            this.loadMoreItems();
        } else {
            // If only minor settings (like timestamps) changed, update existing items without a full re-render.
            this.updateExistingItems(settings.showTimestamps);
        }
    }

    private updateExistingItems(showTimestamps: boolean) {
        if (!this.listEl) return;
        this.listEl.querySelectorAll('.v-history-entry').forEach((entryEl: HTMLElement) => {
            const timestampEl = entryEl.querySelector<HTMLElement>('.v-version-timestamp');
            if (timestampEl) timestampEl.style.display = showTimestamps ? '' : 'none';
        });
    }

    private renderSkeleton() {
        this.listEl.empty();
        for (let i = 0; i < 5; i++) {
            this.renderSkeletonEntry(this.listEl);
        }
    }

    private loadMoreItems() {
        this.observer?.disconnect();
        const currentCount = this.displayedCount;
        this.displayedCount = Math.min(currentCount + this.PAGE_SIZE, this.history.length);
        
        const fragment = document.createDocumentFragment();
        for (let i = currentCount; i < this.displayedCount; i++) {
            try {
                this.renderHistoryEntry(fragment, this.history[i]);
            } catch (error) {
                console.error("Version Control: Failed to render a history entry. The entry may have corrupt data.", {
                    entry: this.history[i],
                    error,
                });
                // Render an error entry in its place
                this.renderErrorEntry(fragment, this.history[i]);
            }
        }
        this.listEl.appendChild(fragment);
        
        this.setupInfiniteScroll();
    }

    private setupInfiniteScroll() {
        if (this.displayedCount < this.history.length) {
            let sentinel = this.listEl.querySelector('.v-scroll-sentinel');
            if (!sentinel) {
                sentinel = this.listEl.createDiv("v-scroll-sentinel");
            }
            this.observer = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        this.loadMoreItems();
                    }
                },
                { root: this.listEl, rootMargin: '200px' }
            );
            this.observer.observe(sentinel);
        }
    }

    private renderHistoryEntry(parent: DocumentFragment | HTMLElement, version: VersionHistoryEntry) {
        const { settings } = this.plugin.store.getState();
        const entryEl = parent.createDiv("v-history-entry");
        entryEl.classList.toggle('is-list-view', settings.isListView);

        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version.versionNumber}` });
        if (version.name) header.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
        
        const timestampEl = header.createSpan({ cls: "v-version-timestamp", text: moment(version.timestamp).fromNow(), attr: { "title": moment(version.timestamp).format("YYYY-MM-DD HH:mm:ss") } });
        timestampEl.style.display = settings.showTimestamps ? '' : 'none';

        if (settings.isListView) {
            // In list view, the whole item is clickable to show the context menu.
            entryEl.addEventListener("click", (e) => this.showContextMenu(version, e));
            entryEl.addEventListener("contextmenu", (e) => this.showContextMenu(version, e));
        } else {
            // In card view, show content and action buttons. No context menu on the card itself.
            const contentEl = entryEl.createDiv("v-version-content");
            contentEl.setText(`Size: ${formatFileSize(version.size)}`);
            const footer = entryEl.createDiv("v-entry-footer");
            this.createActionButtons(footer, version);
        }
    }

    private renderErrorEntry(parent: DocumentFragment | HTMLElement, version: VersionHistoryEntry) {
        const entryEl = parent.createDiv("v-history-entry");
        entryEl.style.borderColor = 'var(--color-red)';
        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version?.versionNumber ?? '??'}` });
        header.createDiv({ cls: "v-version-name", text: "Error rendering this entry" });
        const contentEl = entryEl.createDiv("v-version-content");
        contentEl.setText("Check developer console for details.");
    }

    private createActionButtons(container: HTMLElement, version: VersionHistoryEntry) {
        versionActions.forEach(({ icon, tooltip, isDanger, thunk }) => {
            const btn = container.createEl("button", { 
                cls: `v-action-btn ${isDanger ? 'danger' : ''}`, 
                attr: { "aria-label": tooltip, "title": tooltip } 
            });
            setIcon(btn, icon);
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.plugin.store.dispatch(thunk(version));
            });
        });
    }

    private showContextMenu(version: VersionHistoryEntry, event: MouseEvent) {
        showVersionContextMenu(version, event, this.plugin.store);
    }

    private renderSkeletonEntry(parent: HTMLElement) {
        const entryEl = parent.createDiv("v-history-entry is-skeleton");
        const header = entryEl.createDiv("v-entry-header");
        header.createDiv("v-version-id v-skeleton-item");
        header.createDiv("v-version-name v-skeleton-item");
        header.createDiv("v-version-timestamp v-skeleton-item");
        entryEl.createDiv("v-version-content v-skeleton-item");
    }

    private renderEmptyState(icon: string, title: string, subtitle: string) {
        const emptyState = this.listEl.createDiv({ cls: "v-empty-state" });
        setIcon(emptyState.createDiv({ cls: "v-empty-state-icon" }), icon);
        emptyState.createEl("p", { text: title });
        if (subtitle) {
            emptyState.createEl("p", { text: subtitle, cls: "v-meta-label" });
        }
    }

    destroy() {
        this.observer?.disconnect();
        this.container.empty();
    }
}