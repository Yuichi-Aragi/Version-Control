import { setIcon, Component } from "obsidian";
import { debounce } from 'lodash-es';
import { AppStore } from "../../state/store";
import { AppState, AppStatus } from "../../state/state";
import { actions } from "../../state/appSlice";
import { thunks } from "../../state/thunks/index";
// FIX: Removed unused imports for Menu, SortOrder, and VersionControlSettings.

export class ActionBarComponent extends Component {
    private container: HTMLElement;
    protected store: AppStore;

    // Element references
    // FIX: Use definite assignment assertion '!' for all properties that are
    // correctly initialized in methods called from the constructor.
    private defaultActionsEl!: HTMLElement;
    private searchContainerEl!: HTMLElement;
    private searchInput!: HTMLInputElement;
    private caseButton!: HTMLButtonElement;
    private clearButton!: HTMLButtonElement;
    private saveButton!: HTMLButtonElement;
    private searchToggleButton!: HTMLButtonElement;
    private diffIndicatorButton!: HTMLButtonElement;
    private settingsButton!: HTMLButtonElement;
    private searchIconEl!: HTMLElement;
    private filterButton!: HTMLButtonElement;
    private watchModeTimerEl!: HTMLElement;

    constructor(parent: HTMLElement, store: AppStore) {
        super();
        this.container = parent.createDiv("v-actions-container");
        this.store = store;
        
        this.buildDefaultActions();
        this.buildSearchBar();
        
        this.container.hide();
    }

    private buildDefaultActions() {
        this.defaultActionsEl = this.container.createDiv("v-top-actions");
        
        const leftGroup = this.defaultActionsEl.createDiv('v-top-actions-left-group');

        this.saveButton = leftGroup.createEl("button", { text: "Save New Version", cls: "v-save-button" });
        this.saveButton.setAttribute("aria-label", "Save a new version of the current note");
        this.saveButton.addEventListener("click", () => this.handleSaveVersionClick());

        this.watchModeTimerEl = leftGroup.createDiv('v-watch-mode-timer');
        this.watchModeTimerEl.hide();

        const rightGroup = this.defaultActionsEl.createDiv('v-top-actions-right-group');

        this.diffIndicatorButton = rightGroup.createEl("button", { cls: "clickable-icon v-diff-indicator", attr: { "aria-label": "View ready diff" } });
        this.diffIndicatorButton.hide();
        this.diffIndicatorButton.addEventListener("click", () => {
            this.store.dispatch(thunks.viewReadyDiff());
        });

        this.searchToggleButton = rightGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Search history" } });
        setIcon(this.searchToggleButton, "search");
        this.searchToggleButton.addEventListener("click", () => {
            const currentState = this.store.getState();
            if (currentState.status !== AppStatus.READY) return;
            this.store.dispatch(actions.toggleSearch(!currentState.isSearchActive));
        });
        
        this.settingsButton = rightGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Toggle Settings" } });
        setIcon(this.settingsButton, "settings-2");
        this.settingsButton.addEventListener("click", () => {
            const currentState = this.store.getState();
            if (currentState.status !== AppStatus.READY) return;

            if (currentState.panel?.type === 'settings') {
                this.store.dispatch(actions.closePanel());
            } else {
                this.store.dispatch(actions.openPanel({ type: 'settings' }));
            }
        });
    }

    private buildSearchBar() {
        this.searchContainerEl = this.container.createDiv("v-search-bar-container");

        const inputWrapper = this.searchContainerEl.createDiv('v-search-input-wrapper');
        
        this.searchIconEl = inputWrapper.createDiv('v-search-icon');
        setIcon(this.searchIconEl, 'x-circle');
        this.searchIconEl.setAttribute('role', 'button');
        this.searchIconEl.setAttribute('aria-label', 'Close search');
        this.searchIconEl.addEventListener('mousedown', (event: MouseEvent) => {
            event.preventDefault();
            this.store.dispatch(actions.toggleSearch(false));
        });

        this.searchInput = inputWrapper.createEl('input', {
            type: 'search',
            placeholder: 'Search versions...',
        });
        this.searchInput.setAttribute('aria-label', 'Search versions by name, date, or size');

        const debouncedSearch = debounce((value: string) => {
            this.store.dispatch(actions.setSearchQuery(value));
        }, 300, { leading: true, trailing: true });

        this.searchInput.addEventListener('input', () => {
            debouncedSearch(this.searchInput.value);
        });
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.store.dispatch(actions.toggleSearch(false));
            }
        });

        const inputButtons = inputWrapper.createDiv('v-search-input-buttons');

        this.caseButton = inputButtons.createEl('button', {
            cls: 'clickable-icon', attr: { 'aria-label': 'Toggle case sensitivity' }
        });
        setIcon(this.caseButton, 'case-sensitive');
        this.caseButton.addEventListener('mousedown', (event: MouseEvent) => {
            event.preventDefault();
            const state = this.store.getState();
            if (state.status === AppStatus.READY) {
                const newActiveState = !state.isSearchCaseSensitive;
                this.store.dispatch(actions.setSearchCaseSensitivity(newActiveState));
            }
        });

        this.clearButton = inputButtons.createEl('button', {
            cls: 'clickable-icon', attr: { 'aria-label': 'Clear search' }
        });
        setIcon(this.clearButton, 'x');
        this.clearButton.addEventListener('mousedown', (event: MouseEvent) => {
            event.preventDefault();
            this.store.dispatch(actions.setSearchQuery(''));
            this.searchInput.focus();
        });

        this.filterButton = this.searchContainerEl.createEl('button', {
            cls: 'clickable-icon v-filter-button', attr: { 'aria-label': 'Sort options' }
        });
        setIcon(this.filterButton, 'filter');
        this.filterButton.addEventListener('mousedown', (event: MouseEvent) => {
            event.preventDefault();
            this.store.dispatch(thunks.showSortMenu(event));
        });
    }

    render(state: AppState) {
        if (state.status !== AppStatus.READY) {
            this.container.hide();
            return;
        }
        this.container.show();

        const { isSearchActive, searchQuery, isSearchCaseSensitive, isProcessing, diffRequest, settings, watchModeCountdown } = state;
        
        this.container.classList.toggle('is-searching', isSearchActive);
        this.searchContainerEl.classList.toggle('is-query-active', searchQuery.trim().length > 0);

        this.saveButton.disabled = isProcessing;
        this.searchToggleButton.disabled = isProcessing;
        this.settingsButton.disabled = isProcessing;
        this.searchToggleButton.classList.toggle('is-active', isSearchActive);
        this.settingsButton.classList.toggle('is-active', state.panel?.type === 'settings');

        this.renderDiffIndicator(diffRequest);
        this.renderWatchModeTimer(settings.enableWatchMode, watchModeCountdown, isProcessing);

        if (this.searchInput.value !== searchQuery) {
            this.searchInput.value = searchQuery;
        }
        this.caseButton.classList.toggle('is-active', isSearchCaseSensitive);
        this.clearButton.style.display = searchQuery ? 'flex' : 'none';

        if (isSearchActive && document.activeElement !== this.searchInput) {
            setTimeout(() => this.searchInput.focus(), 100);
        }
    }

    private renderDiffIndicator(diffRequest: AppState['diffRequest']) {
        if (!diffRequest) {
            this.diffIndicatorButton.hide();
            this.diffIndicatorButton.className = "clickable-icon v-diff-indicator";
            return;
        }

        this.diffIndicatorButton.show();
        this.diffIndicatorButton.disabled = false;

        switch (diffRequest.status) {
            case 'generating':
                this.diffIndicatorButton.className = "clickable-icon v-diff-indicator is-generating";
                setIcon(this.diffIndicatorButton, "loader");
                this.diffIndicatorButton.setAttribute("aria-label", "Diff is being generated...");
                this.diffIndicatorButton.disabled = true;
                break;
            case 'ready':
                this.diffIndicatorButton.className = "clickable-icon v-diff-indicator is-ready";
                setIcon(this.diffIndicatorButton, "diff");
                this.diffIndicatorButton.setAttribute("aria-label", "Diff is ready. Click to view.");
                break;
        }
    }

    private renderWatchModeTimer(isWatchModeEnabled: boolean, countdown: number | null, isProcessing: boolean) {
        if (isWatchModeEnabled && countdown !== null && !isProcessing) {
            this.watchModeTimerEl.setText(`(${countdown}s)`);
            this.watchModeTimerEl.show();
        } else {
            this.watchModeTimerEl.hide();
        }
    }

    private handleSaveVersionClick() {
        const state = this.store.getState();
        if (state.status !== AppStatus.READY || state.isProcessing) return;
        this.store.dispatch(thunks.saveNewVersion());
    }
    
    public getContainer(): HTMLElement {
        return this.container;
    }

    onunload() {
        this.container.remove();
    }
}
