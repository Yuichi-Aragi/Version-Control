import { setIcon, debounce } from "obsidian";
import type { AppStore } from "../../state/store";
import type { ActionPanel as ActionPanelState, ActionItem } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";
import type { AppThunk }from "../../state/store";

export class ActionPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private filterInput: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;
    private currentItems: ActionItem<any>[] = [];
    private onChooseAction: ((data: any) => AppThunk) | null = null;
    private focusedIndex: number = -1;
    private debouncedFilter: (value: string) => void;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container"]);
        this.innerPanel = this.container.createDiv({ cls: "v-inline-panel v-action-panel" });
        this.container.classList.add('is-modal-like');
        this.debouncedFilter = debounce(this.filterList, 150, true);
    }

    render(panelState: ActionPanelState<any> | null) {
        this.toggle(!!panelState);

        if (!panelState) {
            if (this.innerPanel.hasChildNodes()) {
                this.innerPanel.empty();
                this.cleanup();
            }
            return;
        }

        this.innerPanel.empty();
        this.currentItems = panelState.items;
        this.onChooseAction = panelState.onChooseAction;
        this.focusedIndex = -1;

        // Header
        const header = this.innerPanel.createDiv("v-panel-header");
        header.createEl("h3", { text: panelState.title });
        const closeBtn = header.createEl("button", { 
            cls: "clickable-icon v-panel-close", 
            attr: { "aria-label": "Close", "title": "Close" } 
        });
        setIcon(closeBtn, "x");
        this.registerDomEvent(closeBtn, "click", () => this.store.dispatch(actions.closePanel()));

        // Filter input
        if (panelState.showFilter) {
            const filterContainer = this.innerPanel.createDiv('v-action-panel-filter');
            this.filterInput = filterContainer.createEl('input', {
                type: 'text',
                placeholder: 'Filter options...'
            });
            this.registerDomEvent(this.filterInput, 'input', () => this.debouncedFilter(this.filterInput?.value ?? ''));
            this.registerDomEvent(this.filterInput, 'keydown', this.handleKeyDown);
        }

        // List
        this.listEl = this.innerPanel.createDiv('v-action-panel-list');
        this.renderList(this.currentItems);

        // Focus management
        setTimeout(() => {
            if (this.filterInput) {
                this.filterInput.focus();
            } else if (this.listEl?.children[0]) {
                (this.listEl.children[0] as HTMLElement).focus();
                this.focusedIndex = 0;
            }
        }, 50);
    }

    private cleanup() {
        this.filterInput = null;
        this.listEl = null;
        this.currentItems = [];
        this.onChooseAction = null;
        this.focusedIndex = -1;
    }

    private filterList = (query: string) => {
        const lowerCaseQuery = query.toLowerCase();
        const filteredItems = this.currentItems.filter(item => 
            item.text.toLowerCase().includes(lowerCaseQuery) || 
            (item.subtext && item.subtext.toLowerCase().includes(lowerCaseQuery))
        );
        this.renderList(filteredItems);
    }

    private renderList(items: ActionItem<any>[]) {
        if (!this.listEl) return;
        this.listEl.empty();
        this.focusedIndex = -1;

        if (items.length === 0) {
            this.listEl.createDiv({ cls: 'v-action-panel-empty', text: 'No matching options.' });
            return;
        }

        items.forEach((item) => {
            const itemEl = this.listEl!.createDiv({ cls: 'v-action-panel-item', attr: { tabindex: '0' } });
            itemEl.toggleClass('is-selected', !!item.isSelected);

            const iconToShow = item.isSelected ? 'check' : item.icon;
            if (iconToShow) {
                const iconEl = itemEl.createSpan('v-action-item-icon');
                setIcon(iconEl, iconToShow);
            }

            const textWrapper = itemEl.createDiv('v-action-item-text-wrapper');
            textWrapper.createDiv({ cls: 'v-action-item-text', text: item.text });
            if (item.subtext) {
                textWrapper.createDiv({ cls: 'v-action-item-subtext', text: item.subtext });
            }
            
            this.registerDomEvent(itemEl, 'click', () => this.chooseItem(item.data));
            this.registerDomEvent(itemEl, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.chooseItem(item.data);
                } else {
                    this.handleKeyDown(e);
                }
            });
            this.registerDomEvent(itemEl, 'focus', () => {
                this.focusedIndex = Array.from(this.listEl!.children).indexOf(itemEl);
            });
        });
    }

    private chooseItem(data: any) {
        if (this.onChooseAction) {
            // The thunk returned by onChooseAction is solely responsible for managing
            // the panel state. It will either dispatch a new `openPanel` action, which
            // atomically replaces the current panel, or `closePanel` if it's the
            // end of an interaction chain. This provides predictable state transitions.
            this.store.dispatch(this.onChooseAction(data));
        }
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (!this.listEl || this.listEl.children.length === 0) return;

        const items = Array.from(this.listEl.children) as HTMLElement[];
        let nextIndex = this.focusedIndex;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            nextIndex = this.focusedIndex < 0 ? 0 : (this.focusedIndex + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const firstItem = items[0];
            if (this.filterInput && firstItem && document.activeElement === firstItem) {
                this.filterInput.focus();
                return;
            }
            nextIndex = this.focusedIndex < 0 ? items.length - 1 : (this.focusedIndex - 1 + items.length) % items.length;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.store.dispatch(actions.closePanel());
            return;
        }

        if (nextIndex !== this.focusedIndex) {
            const itemToFocus = items[nextIndex];
            if (itemToFocus) {
                itemToFocus.focus();
            }
        }
    }

    override onunload() {
        this.cleanup();
        super.onunload();
    }
}
