import { setIcon, moment, HTMLElement as ObsidianHTMLElement, MouseEvent as ObsidianMouseEvent, Component } from "obsidian";
import { VersionHistoryEntry } from "../../types";
import { formatFileSize } from "../utils/dom";
import { Store } from "../../state/store";
import { ReadyState, AppStatus } from "../../state/state";
import { versionActions, VersionActionConfig } from "../VersionActions"; 
import { thunks } from "../../state/thunks/index";
import { actions } from "../../state/actions";


export class HistoryListComponent extends Component {
    private container: ObsidianHTMLElement;
    private listEl: ObsidianHTMLElement | null = null;
    private countEl: ObsidianHTMLElement | null = null;
    private store: Store;

    // --- State Caching and Rendering Control ---
    private currentProcessedHistoryIds: string[] | null = null;
    private processedHistory: VersionHistoryEntry[] = [];
    private currentSettingsSnapshot: { 
        isListView?: boolean; 
        showTimestamps?: boolean;
        namingVersionId?: string | null;
        highlightedVersionId?: string | null;
    } = {};

    // --- Infinite Scroll ---
    private expandedTags: Set<string> = new Set();
    private displayedItemsCount = 0;
    private readonly ITEMS_PER_PAGE = 30;
    private intersectionObserver: IntersectionObserver | null = null;
    private sentinelEl: ObsidianHTMLElement | null = null;

    constructor(parent: ObsidianHTMLElement, store: Store) {
        super();
        this.container = parent.createDiv("v-history-list-container");
        this.store = store;
        this.container.hide();
    }

    render(state: ReadyState) {
        // 1. Calculate new data state based on current filters and sorting
        const newProcessedHistory = this.getFilteredAndSortedHistory(state);
        const newHistoryIds = newProcessedHistory.map(h => h.id);

        // 2. Determine if a hard reset of the list is needed. This happens if:
        //    - The set of visible version IDs changes (due to filtering/new versions).
        //    - The fundamental view mode (list vs. card) changes.
        const historyIdsChanged = this.currentProcessedHistoryIds === null || this.currentProcessedHistoryIds.join(',') !== newHistoryIds.join(',');
        const viewModeChanged = this.currentSettingsSnapshot.isListView !== state.settings.isListView;

        if (historyIdsChanged || viewModeChanged) {
            // Perform a full rebuild of the list DOM.
            this.performHardReset(state, newProcessedHistory, newHistoryIds);
        } else {
            // If we are here, the list of items is the same, but their content (e.g., name, tags) might have changed.
            // First, update the component's internal cache of processed history with the new data.
            this.processedHistory = newProcessedHistory;
            // Then, perform "soft" updates on the existing DOM elements without a full rebuild.
            this.performSoftUpdates(state);
        }

        // 3. Always update dynamic elements like the version count.
        this.updateCountDisplay(newProcessedHistory.length, state.history.length);
        this.container.show();
    }

    private performHardReset(state: ReadyState, newProcessedHistory: VersionHistoryEntry[], newHistoryIds: string[]) {
        // --- Update internal state ---
        this.processedHistory = newProcessedHistory;
        this.currentProcessedHistoryIds = newHistoryIds;
        this.currentSettingsSnapshot = {
            isListView: state.settings.isListView,
            showTimestamps: state.settings.showTimestamps,
            namingVersionId: state.namingVersionId,
            highlightedVersionId: state.highlightedVersionId,
        };
        
        // --- Reset infinite scroll state ---
        this.displayedItemsCount = 0;
        this.cleanupObserver();
        this.expandedTags.clear();

        // --- Rebuild DOM structure ---
        this.container.empty();
        this.buildSkeletonDOM(state);

        // --- Render content ---
        if (state.history.length === 0) {
            this.renderEmptyState("inbox", "No versions saved yet.", "Click 'Save New Version' to begin tracking changes.");
        } else if (newProcessedHistory.length === 0) {
            this.renderEmptyState("search-x", "No matching versions found.", `Try a different search query (e.g., 'tag:mytag') or change sort options.`);
        } else {
            this.loadMoreItems(state); // This will load the first page
        }
    }

    private performSoftUpdates(state: ReadyState) {
        // Naming state change
        const oldNamingId = this.currentSettingsSnapshot.namingVersionId;
        const newNamingId = state.namingVersionId;
        if (oldNamingId !== newNamingId) {
            this.updateNamingState(oldNamingId, newNamingId, state);
            this.currentSettingsSnapshot.namingVersionId = newNamingId;
        }

        // Timestamp visibility change
        const timestampVisibilityChanged = this.currentSettingsSnapshot.showTimestamps !== state.settings.showTimestamps;
        if (timestampVisibilityChanged) {
            this.currentSettingsSnapshot.showTimestamps = state.settings.showTimestamps;
            this.listEl?.classList.toggle('hide-timestamps', !state.settings.showTimestamps);
        }

        // Highlight change
        const highlightChanged = this.currentSettingsSnapshot.highlightedVersionId !== state.highlightedVersionId;
        if (highlightChanged) {
            this.updateHighlight(state.highlightedVersionId);
            this.currentSettingsSnapshot.highlightedVersionId = state.highlightedVersionId;
        }
    }

    private updateNamingState(oldNamingId: string | null | undefined, newNamingId: string | null, state: ReadyState) {
        if (!this.listEl) return;
    
        const reRenderEntry = (versionId: string | null | undefined) => {
            if (!versionId) return;
            const entryEl = this.listEl!.querySelector(`[data-version-id="${versionId}"]`) as HTMLElement;
            const versionData = this.processedHistory.find(v => v.id === versionId);
            if (entryEl && versionData) {
                const fragment = document.createDocumentFragment();
                // We pass the *current* state to renderHistoryEntry to ensure it has the latest namingVersionId
                this.renderHistoryEntry(fragment, versionData, state);
                const newEntryEl = fragment.firstElementChild;
                if (newEntryEl) {
                    entryEl.replaceWith(newEntryEl);
                }
            }
        };
    
        // Re-render both the old and new entries to correctly update their states
        reRenderEntry(oldNamingId);
        reRenderEntry(newNamingId);
    }

    renderAsLoading() {
        this.cleanupObserver();
        this.container.empty();
        this.currentProcessedHistoryIds = null; 
        this.currentSettingsSnapshot = {};

        this.buildSkeletonDOM(null); 
        this.updateCountDisplay("Loading...");

        if (this.listEl) {
            for (let i = 0; i < 5; i++) { 
                this.renderSkeletonEntry(this.listEl);
            }
        }
        this.container.show();
    }
    
    private getFilteredAndSortedHistory(state: ReadyState): VersionHistoryEntry[] {
        let history = [...state.history];
        const { searchQuery, isSearchCaseSensitive } = state;

        if (searchQuery.trim().toLowerCase().startsWith('tag:')) {
            const tagsToSearch = searchQuery.replace(/tag:/i, '').trim().split(/\s+/).filter(t => t);
            if (tagsToSearch.length > 0) {
                history = history.filter(v => {
                    if (!v.tags || v.tags.length === 0) return false;
                    const versionTags = new Set(v.tags.map(t => isSearchCaseSensitive ? t : t.toLowerCase()));
                    return tagsToSearch.every(searchTag => versionTags.has(isSearchCaseSensitive ? searchTag : searchTag.toLowerCase()));
                });
            }
        } else if (searchQuery.trim() !== '') {
            const query = searchQuery.trim();
            history = history.filter(v => {
                const searchableString = [
                    `V${v.versionNumber}`,
                    v.name || '',
                    ...(v.tags || []).map(t => `#${t}`),
                    moment(v.timestamp).fromNow(true),
                    moment(v.timestamp).format("LLLL"),
                    formatFileSize(v.size)
                ].join(' ');

                if (isSearchCaseSensitive) {
                    return searchableString.includes(query);
                }
                return searchableString.toLowerCase().includes(query.toLowerCase());
            });
        }

        const { property, direction } = state.sortOrder;
        history.sort((a, b) => {
            let comparison = 0;
            switch (property) {
                case 'name':
                    const nameA = a.name?.toLowerCase() || '\uffff';
                    const nameB = b.name?.toLowerCase() || '\uffff';
                    if (nameA < nameB) comparison = -1;
                    if (nameA > nameB) comparison = 1;
                    break;
                case 'size':
                    comparison = a.size - b.size;
                    break;
                case 'timestamp':
                    comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
                    break;
                case 'versionNumber':
                default:
                    comparison = a.versionNumber - b.versionNumber;
                    break;
            }
            if (property === 'timestamp' || property === 'versionNumber') {
                 return direction === 'asc' ? comparison : comparison * -1;
            }
            return direction === 'desc' ? comparison * -1 : comparison;
        });

        return history;
    }

    private buildSkeletonDOM(state: ReadyState | null) {
        const header = this.container.createDiv("v-history-header");
        setIcon(header, "history");
        header.createSpan({ text: " Version History" });
        this.countEl = header.createSpan("v-history-count");
        
        this.listEl = this.container.createDiv("v-history-list");
        if (state && this.listEl) { 
            this.listEl.classList.toggle('hide-timestamps', !state.settings.showTimestamps);
        }
    }

    private updateCountDisplay(shown: number | string, total?: number) {
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
    
    private cleanupObserver() {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.sentinelEl) {
            this.sentinelEl.remove();
            this.sentinelEl = null;
        }
    }

    private loadMoreItems(state: ReadyState) {
        if (!this.listEl || this.displayedItemsCount >= this.processedHistory.length) {
            this.cleanupObserver(); 
            return;
        }

        const fragment = document.createDocumentFragment();
        const end = Math.min(this.displayedItemsCount + this.ITEMS_PER_PAGE, this.processedHistory.length);
        
        for (let i = this.displayedItemsCount; i < end; i++) {
            try {
                this.renderHistoryEntry(fragment, this.processedHistory[i], state);
            } catch (error) {
                console.error("VC: Failed to render a history entry.", { entry: this.processedHistory[i], error });
                this.renderErrorEntry(fragment, this.processedHistory[i]); 
            }
        }
        this.listEl.appendChild(fragment);
        this.displayedItemsCount = end;

        if (this.displayedItemsCount < this.processedHistory.length) {
            if (!this.sentinelEl || !this.listEl.contains(this.sentinelEl)) {
                this.sentinelEl = this.listEl.createDiv("v-scroll-sentinel");
                this.sentinelEl.setAttribute("aria-hidden", "true"); 
            }
            if (this.sentinelEl.parentElement !== this.listEl) {
                 this.listEl.appendChild(this.sentinelEl);
            }

            if (!this.intersectionObserver) {
                this.intersectionObserver = new IntersectionObserver(
                    (entries) => {
                        if (entries[0]?.isIntersecting) {
                            const freshState = this.store.getState();
                            if (freshState.status === AppStatus.READY) {
                                this.loadMoreItems(freshState);
                            }
                        }
                    },
                    { root: this.listEl, rootMargin: '200px 0px' } 
                );
            }
            this.intersectionObserver.observe(this.sentinelEl);
        } else {
            this.cleanupObserver(); 
        }
    }

    private renderHistoryEntry(parent: DocumentFragment | ObsidianHTMLElement, version: VersionHistoryEntry, state: ReadyState) {
        const { settings, namingVersionId, highlightedVersionId } = state;
        const isNamingThisVersion = version.id === namingVersionId;

        const entryEl = parent.createDiv("v-history-entry");
        entryEl.toggleClass('is-list-view', settings.isListView);
        entryEl.toggleClass('is-naming', isNamingThisVersion);
        entryEl.toggleClass('is-highlighted', version.id === highlightedVersionId);
        entryEl.toggleClass('is-tags-expanded', this.expandedTags.has(version.id));
        entryEl.setAttribute('role', 'listitem');
        entryEl.dataset.versionId = version.id;

        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version.versionNumber}` });
        
        if (isNamingThisVersion) {
            this.renderNameInput(header, version);
        } else {
            if (settings.isListView) {
                const mainInfoWrapper = header.createDiv('v-entry-main-info');
                if (version.name) {
                    mainInfoWrapper.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
                }
                if (version.tags && version.tags.length > 0) {
                    this.renderTags(mainInfoWrapper, version, true);
                }
            } else {
                // Card View
                if (version.name) {
                    header.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
                }
            }
        }
        
        const timestampEl = header.createSpan({ cls: "v-version-timestamp" });
        timestampEl.setText(moment(version.timestamp).fromNow(!settings.showTimestamps));
        timestampEl.setAttribute("title", moment(version.timestamp).format("LLLL")); 

        if (settings.isListView) {
            entryEl.addEventListener("click", (e) => this.handleEntryClick(version, e));
            entryEl.addEventListener("contextmenu", (e) => this.handleEntryContextMenu(version, e));
            entryEl.setAttribute('tabindex', '0');
            entryEl.addEventListener('keydown', (e) => this.handleEntryKeyDown(version, e));
        } else {
            // Card View
            entryEl.addEventListener("contextmenu", (e) => this.handleEntryContextMenu(version, e));
            const contentEl = entryEl.createDiv("v-version-content");
            contentEl.setText(`Size: ${formatFileSize(version.size)}`);
            if (version.tags && version.tags.length > 0) {
                this.renderTags(entryEl, version, false);
            }
            const footer = entryEl.createDiv("v-entry-footer");
            this.createActionButtons(footer, version);
        }
    }

    private renderTags(parent: HTMLElement, version: VersionHistoryEntry, isListView: boolean) {
        const tagsContainer = parent.createDiv('v-version-tags');
        tagsContainer.toggleClass('is-list-view', isListView);

        tagsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const entryEl = (e.currentTarget as HTMLElement).closest('.v-history-entry');
            if (entryEl) {
                if (this.expandedTags.has(version.id)) {
                    this.expandedTags.delete(version.id);
                } else {
                    this.expandedTags.add(version.id);
                }
                entryEl.classList.toggle('is-tags-expanded');
            }
        });

        (version.tags || []).forEach(tag => {
            const tagEl = tagsContainer.createSpan('v-version-tag');
            tagEl.setText(`#${tag}`);
            tagEl.setAttribute('title', `#${tag}`);
        });
    }

    private renderNameInput(parent: HTMLElement, version: VersionHistoryEntry) {
        const initialValue = [
            version.name || '',
            ...(version.tags || []).map(t => `#${t}`)
        ].join(' ').trim();

        const input = parent.createEl('input', {
            type: 'text',
            cls: 'v-version-name-input',
            value: initialValue,
            attr: {
                placeholder: 'Name and #tags...',
                'aria-label': 'Version name and tags input'
            }
        });

        const saveDetails = () => {
            if (!input.isConnected) return;
            const rawValue = input.value.trim();
            if (rawValue !== initialValue) {
                this.store.dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        input.addEventListener('blur', () => {
            setTimeout(saveDetails, 100); // A small delay to prevent race conditions
        });

        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveDetails();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.store.dispatch(actions.stopVersionEditing());
            }
        });

        requestAnimationFrame(() => {
            input.focus();
            // Don't pre-select, just move cursor to the end
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }

    private handleEntryClick(version: VersionHistoryEntry, event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        this.store.dispatch(thunks.showPreviewOptions(version, event as unknown as ObsidianMouseEvent));
    }

    private handleEntryContextMenu(version: VersionHistoryEntry, event: MouseEvent) {
        // Don't open context menu if user is editing the name/tags
        if (event.target instanceof HTMLInputElement && event.target.classList.contains('v-version-name-input')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.store.dispatch(thunks.showVersionContextMenu(version, event as unknown as ObsidianMouseEvent));
    }

    private handleEntryKeyDown(version: VersionHistoryEntry, event: KeyboardEvent) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            let mouseEvent: ObsidianMouseEvent;
            if (event.target instanceof HTMLElement) { 
                const rect = event.target.getBoundingClientRect();
                mouseEvent = new MouseEvent("contextmenu", {
                    bubbles: true, cancelable: true,
                    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
                }) as unknown as ObsidianMouseEvent;
            } else {
                mouseEvent = new MouseEvent("contextmenu") as unknown as ObsidianMouseEvent;
            }
            this.store.dispatch(thunks.showVersionContextMenu(version, mouseEvent));
        }
    }

    private renderErrorEntry(parent: DocumentFragment | ObsidianHTMLElement, version: VersionHistoryEntry | null) {
        const entryEl = parent.createDiv("v-history-entry is-error");
        entryEl.setAttribute('role', 'listitem');
        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version?.versionNumber ?? '??'}` });
        header.createDiv({ cls: "v-version-name", text: "Error rendering this entry" });
        const iconSpan = header.createSpan({cls: "v-error-icon"});
        setIcon(iconSpan, "alert-circle");
        const contentEl = entryEl.createDiv("v-version-content");
        contentEl.setText("Issue displaying this version. Check console.");
    }

    private createActionButtons(container: ObsidianHTMLElement, version: VersionHistoryEntry) {
        const viewBtn = container.createEl("button", {
            cls: "v-action-btn",
            attr: { "aria-label": "View content options", "title": "View content options" }
        });
        setIcon(viewBtn, "eye");
        viewBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation(); 
            this.store.dispatch(thunks.showPreviewOptions(version, e as unknown as ObsidianMouseEvent));
        });

        versionActions.forEach((actionConfig: VersionActionConfig) => {
            const btn = container.createEl("button", { 
                cls: `v-action-btn ${actionConfig.isDanger ? 'danger' : ''}`, 
                attr: { "aria-label": actionConfig.tooltip, "title": actionConfig.tooltip } 
            });
            setIcon(btn, actionConfig.icon);
            btn.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                actionConfig.actionHandler(version, this.store);
            });
        });
    }

    private renderSkeletonEntry(parent: ObsidianHTMLElement) {
        const entryEl = parent.createDiv("v-history-entry is-skeleton");
        const header = entryEl.createDiv("v-entry-header");
        header.createDiv({cls: "v-version-id v-skeleton-item"});
        header.createDiv({cls: "v-version-name v-skeleton-item"});
        header.createDiv({cls: "v-version-timestamp v-skeleton-item"});
        entryEl.createDiv({cls: "v-version-content v-skeleton-item"});
    }

    private renderEmptyState(iconName: string, title: string, subtitle?: string) {
        if (!this.listEl) return;
        this.listEl.empty(); 

        const emptyStateContainer = this.listEl.createDiv({ cls: "v-empty-state" });
        const iconDiv = emptyStateContainer.createDiv({ cls: "v-empty-state-icon" });
        setIcon(iconDiv, iconName);
        emptyStateContainer.createEl("p", { cls: "v-empty-state-title", text: title });
        if (subtitle) {
            emptyStateContainer.createEl("p", { cls: "v-empty-state-subtitle v-meta-label", text: subtitle });
        }
    }

    private updateHighlight(versionId: string | null) {
        if (!this.listEl) return;
        this.listEl.findAll('.is-highlighted').forEach(el => el.removeClass('is-highlighted'));
        if (versionId) {
            const entryToHighlight = this.listEl.querySelector(`[data-version-id="${versionId}"]`);
            entryToHighlight?.addClass('is-highlighted');
        }
    }
    
    public getContainer(): ObsidianHTMLElement {
        return this.container;
    }

    onunload() {
        this.cleanupObserver();
        this.container.remove();
    }
}
