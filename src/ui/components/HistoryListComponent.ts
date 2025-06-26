import { setIcon, moment, HTMLElement as ObsidianHTMLElement, MouseEvent as ObsidianMouseEvent, Component } from "obsidian";
import { VersionHistoryEntry } from "../../types";
import { formatFileSize } from "../utils/dom";
import { Store } from "../../state/store";
import { ReadyState } from "../../state/state";
import { versionActions, VersionActionConfig } from "../VersionActions"; 
import { thunks } from "../../state/thunks/index";
import { actions } from "../../state/actions";


export class HistoryListComponent extends Component {
    private container: ObsidianHTMLElement;
    private listEl: ObsidianHTMLElement | null = null;
    private countEl: ObsidianHTMLElement | null = null;
    private store: Store;

    private processedHistory: VersionHistoryEntry[] = [];

    constructor(parent: ObsidianHTMLElement, store: Store) {
        super();
        this.container = parent.createDiv("v-history-list-container");
        this.store = store;
        this.container.hide();
    }

    render(state: ReadyState) {
        const newProcessedHistory = this.getFilteredAndSortedHistory(state);

        const viewModeChanged = this.listEl && (this.listEl.classList.contains('is-list-view') !== state.settings.isListView);
        const historyIdsChanged = !this.processedHistory || this.processedHistory.map(v => v.id).join(',') !== newProcessedHistory.map(v => v.id).join(',');

        if (viewModeChanged || historyIdsChanged) {
            // Hard reset: The list of items or their fundamental layout has changed.
            // This is necessary for view mode switches, filtering, and sorting.
            this.processedHistory = newProcessedHistory;
            this.rebuildList(state);
        } else {
            // Soft update: The list of items is the same, but their content might have changed (e.g., name, highlight).
            // This is for things like renaming a version or highlighting one for diffing.
            this.processedHistory = newProcessedHistory;
            this.updateExistingEntries(state);
        }

        this.updateCountDisplay(this.processedHistory.length, state.history.length);
        this.container.show();
    }

    renderAsLoading() {
        this.container.empty();
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
            this.listEl.classList.toggle('is-list-view', state.settings.isListView);
        }
    }

    private rebuildList(state: ReadyState) {
        this.container.empty();
        this.buildSkeletonDOM(state);

        if (state.history.length === 0) {
            this.renderEmptyState("inbox", "No versions saved yet.", "Click 'Save New Version' to begin tracking changes.");
            return;
        }
        if (this.processedHistory.length === 0) {
            this.renderEmptyState("search-x", "No matching versions found.", `Try a different search query or change sort options.`);
            return;
        }

        // Suppress entry animations during a full rebuild (sort/filter) to prevent jank
        this.listEl!.addClass('is-rebuilding');

        const fragment = document.createDocumentFragment();
        for (const version of this.processedHistory) {
            try {
                this.renderHistoryEntry(fragment, version, state);
            } catch (error) {
                console.error("VC: Failed to render a history entry.", { entry: version, error });
                this.renderErrorEntry(fragment, version);
            }
        }
        this.listEl!.appendChild(fragment);

        // Re-enable animations after the DOM has settled
        setTimeout(() => this.listEl?.removeClass('is-rebuilding'), 50);
    }

    private updateExistingEntries(state: ReadyState) {
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
                const newEl = this.createHistoryEntry(versionData, state);
                el.replaceWith(newEl);
            } else {
                el.classList.toggle('is-highlighted', versionData.id === state.highlightedVersionId);
            }
        }
        
        this.listEl.classList.toggle('hide-timestamps', !state.settings.showTimestamps);
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

    private createHistoryEntry(version: VersionHistoryEntry, state: ReadyState): HTMLElement {
        const fragment = document.createDocumentFragment();
        this.renderHistoryEntry(fragment, version, state);
        return fragment.firstElementChild as HTMLElement;
    }

    private renderHistoryEntry(parent: DocumentFragment | ObsidianHTMLElement, version: VersionHistoryEntry, state: ReadyState) {
        const { settings, namingVersionId, highlightedVersionId, expandedTagIds } = state;
        const isNamingThisVersion = version.id === namingVersionId;
        const isExpanded = expandedTagIds.includes(version.id);

        const entryEl = parent.createDiv("v-history-entry");
        entryEl.toggleClass('is-list-view', settings.isListView);
        entryEl.toggleClass('is-naming', isNamingThisVersion);
        entryEl.toggleClass('is-highlighted', version.id === highlightedVersionId);
        entryEl.toggleClass('is-tags-expanded', isExpanded);
        entryEl.setAttribute('role', 'listitem');
        entryEl.dataset.versionId = version.id;
        entryEl.dataset.signature = `${version.name || ''}|${(version.tags || []).join(',')}|${isNamingThisVersion}|${isExpanded}`;

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
            this.store.dispatch(actions.toggleTagExpansion(version.id));
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
            // A small delay is a pragmatic way to handle race conditions where a click
            // on another element would blur the input before the click is processed.
            setTimeout(saveDetails, 100);
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
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }

    private handleEntryClick(version: VersionHistoryEntry, event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        // For list view, a direct click should perform the primary action: preview in panel.
        this.store.dispatch(thunks.viewVersionInPanel(version));
    }

    private handleEntryContextMenu(version: VersionHistoryEntry, event: MouseEvent) {
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
            // On keyboard activation, open the full context menu for accessibility.
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
        // The primary action for a card is to preview it in the panel.
        const viewBtn = container.createEl("button", {
            cls: "v-action-btn",
            attr: { "aria-label": "Preview in Panel", "title": "Preview in Panel" }
        });
        setIcon(viewBtn, "eye");
        viewBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation(); 
            this.store.dispatch(thunks.viewVersionInPanel(version));
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
    
    public getContainer(): ObsidianHTMLElement {
        return this.container;
    }

    onunload() {
        this.container.remove();
    }
}
