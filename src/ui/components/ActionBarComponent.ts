import { setIcon, Component, debounce } from "obsidian";
import type { AppStore } from "../../state/store";
import type { AppState } from "../../state/state";
import { AppStatus } from "../../state/state";
import { actions } from "../../state/appSlice";
import { thunks } from "../../state/thunks/index";

export class ActionBarComponent extends Component {
    private container: HTMLElement;
    protected store: AppStore;

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
        
        // Visibility is controlled by VersionControlView via the .is-hidden class
    }

    private buildDefaultActions() {
        this.defaultActionsEl = this.container.createDiv("v-top-actions");
        
        const leftGroup = this.defaultActionsEl.createDiv('v-top-actions-left-group');

        this.saveButton = leftGroup.createEl("button", { text: "Save new version", cls: "v-save-button" });
        this.saveButton.setAttribute("aria-label", "Save a new version of the current note");
        this.registerDomEvent(this.saveButton, "click", () => this.handleSaveVersionClick());

        this.watchModeTimerEl = leftGroup.createDiv('v-watch-mode-timer');
        this.watchModeTimerEl.classList.add('is-hidden');

        const rightGroup = this.defaultActionsEl.createDiv('v-top-actions-right-group');

        this.diffIndicatorButton = rightGroup.createEl("button", { cls: "clickable-icon v-diff-indicator", attr: { "aria-label": "View ready diff" } });
        this.diffIndicatorButton.classList.add('is-hidden');
        this.registerDomEvent(this.diffIndicatorButton, "click", () => {
            // FIX: The user's action of clicking the indicator fulfills the "ready diff" state.
            // We dispatch the action to view the diff and then immediately clear the
            // request state. This "consumes" the indicator and hides it immediately.
            if (this.store.getState().diffRequest?.status === 'ready') {
                this.store.dispatch(thunks.viewReadyDiff());
                this.store.dispatch(actions.clearDiffRequest());
            }
        });

        this.searchToggleButton = rightGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Search history" } });
        setIcon(this.searchToggleButton, "search");
        this.registerDomEvent(this.searchToggleButton, "click", () => {
            const currentState = this.store.getState();
            if (currentState.status !== AppStatus.READY) return;
            this.store.dispatch(actions.toggleSearch(!currentState.isSearchActive));
        });
        
        this.settingsButton = rightGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Toggle settings" } });
        setIcon(this.settingsButton, "settings-2");
        this.registerDomEvent(this.settingsButton, "click", (event: MouseEvent) => {
            event.stopPropagation(); // Prevent click from bubbling, e.g., to a document-level listener
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
        this.registerDomEvent(this.searchIconEl, 'mousedown', (event: MouseEvent) => {
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
        }, 300, true);

        this.registerDomEvent(this.searchInput, 'input', () => {
            debouncedSearch(this.searchInput.value);
        });
        this.registerDomEvent(this.searchInput, 'keydown', (e) => {
            if (e.key === 'Escape') {
                this.store.dispatch(actions.toggleSearch(false));
            }
        });

        const inputButtons = inputWrapper.createDiv('v-search-input-buttons');

        this.caseButton = inputButtons.createEl('button', {
            cls: 'clickable-icon', attr: { 'aria-label': 'Toggle case sensitivity' }
        });
        setIcon(this.caseButton, 'case-sensitive');
        this.registerDomEvent(this.caseButton, 'mousedown', (event: MouseEvent) => {
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
        this.registerDomEvent(this.clearButton, 'mousedown', (event: MouseEvent) => {
            event.preventDefault();
            this.store.dispatch(actions.setSearchQuery(''));
            this.searchInput.focus();
        });

        this.filterButton = this.searchContainerEl.createEl('button', {
            cls: 'clickable-icon v-filter-button', attr: { 'aria-label': 'Sort options' }
        });
        setIcon(this.filterButton, 'filter');
        this.registerDomEvent(this.filterButton, 'mousedown', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation(); // Prevent event from bubbling and interfering with the menu
            this.store.dispatch(thunks.showSortMenu());
        });
    }

    render(state: AppState) {
        if (state.status !== AppStatus.READY) {
            // The parent view will hide this component if the status is not ready.
            return;
        }

        const { isSearchActive, searchQuery, isSearchCaseSensitive, isProcessing, diffRequest, settings, watchModeCountdown, history, isRenaming } = state;
        
        const isBusy = isProcessing || isRenaming;

        this.container.classList.toggle('is-searching', isSearchActive);
        this.searchContainerEl.classList.toggle('is-query-active', searchQuery.trim().length > 0);

        this.saveButton.disabled = isBusy;
        
        this.searchToggleButton.classList.toggle('is-hidden', history.length === 0);
        this.settingsButton.classList.toggle('is-hidden', history.length === 0);

        this.searchToggleButton.disabled = isBusy;
        this.settingsButton.disabled = isBusy;
        this.searchToggleButton.classList.toggle('is-active', isSearchActive);
        this.settingsButton.classList.toggle('is-active', state.panel?.type === 'settings');

        this.renderDiffIndicator(diffRequest, isBusy);
        this.renderWatchModeTimer(settings.enableWatchMode, watchModeCountdown, isProcessing);

        if (this.searchInput.value !== searchQuery) {
            this.searchInput.value = searchQuery;
        }
        this.caseButton.classList.toggle('is-active', isSearchCaseSensitive);
        this.clearButton.classList.toggle('is-hidden', !searchQuery);

        if (isSearchActive && document.activeElement !== this.searchInput) {
            setTimeout(() => this.searchInput.focus(), 100);
        }
    }

    private renderDiffIndicator(diffRequest: AppState['diffRequest'], isBusy: boolean) {
        // FIX: This function was rewritten to use classList methods instead of direct
        // className assignment. This prevents the accidental removal of other classes
        // like `is-hidden` and resolves the rendering bug.
        if (!diffRequest) {
            this.diffIndicatorButton.classList.add('is-hidden');
            this.diffIndicatorButton.classList.remove('is-generating', 'is-ready');
            return;
        }

        this.diffIndicatorButton.classList.remove('is-hidden');
        this.diffIndicatorButton.disabled = false;

        this.diffIndicatorButton.classList.toggle('is-generating', diffRequest.status === 'generating');
        this.diffIndicatorButton.classList.toggle('is-ready', diffRequest.status === 'ready');

        switch (diffRequest.status) {
            case 'generating':
                setIcon(this.diffIndicatorButton, "loader");
                this.diffIndicatorButton.setAttribute("aria-label", "Diff is being generated...");
                this.diffIndicatorButton.disabled = true;
                break;
            case 'ready':
                setIcon(this.diffIndicatorButton, "diff");
                this.diffIndicatorButton.setAttribute("aria-label", "Diff is ready. Click to view.");
                this.diffIndicatorButton.disabled = isBusy;
                break;
        }
    }

    private renderWatchModeTimer(isWatchModeEnabled: boolean, countdown: number | null, isProcessing: boolean) {
        if (isWatchModeEnabled && countdown !== null && !isProcessing) {
            this.watchModeTimerEl.setText(`(${countdown}s)`);
            this.watchModeTimerEl.classList.remove('is-hidden');
        } else {
            this.watchModeTimerEl.classList.add('is-hidden');
        }
    }

    private handleSaveVersionClick() {
        const state = this.store.getState();
        if (state.status !== AppStatus.READY || state.isProcessing || state.isRenaming) return;
        this.store.dispatch(thunks.saveNewVersion());
    }
    
    public getContainer(): HTMLElement {
        return this.container;
    }

    override onunload() {
        this.container.remove();
    }
}
