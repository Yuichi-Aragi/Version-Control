import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import VersionControlPlugin from "../main";
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import { Store } from "../state/store";
import { AppState } from "../state/state";
import { thunks } from "../state/thunks";

// UI Components
import { PlaceholderComponent } from "./components/PlaceholderComponent";
import { ActionBarComponent } from "./components/ActionBarComponent";
import { SettingsPanelComponent } from "./components/SettingsPanelComponent";
import { HistoryListComponent } from "./components/HistoryListComponent";
import { PreviewPanelComponent } from "./components/PreviewPanelComponent";
import { ConfirmationPanelComponent } from "./components/ConfirmationPanelComponent";

export class VersionControlView extends ItemView {
    plugin: VersionControlPlugin;
    store: Store;
    private unsubscribe: () => void;
    
    // Component Instances
    private placeholderComponent: PlaceholderComponent;
    private actionBarComponent: ActionBarComponent;
    private settingsPanelComponent: SettingsPanelComponent;
    private historyListComponent: HistoryListComponent;
    private previewPanelComponent: PreviewPanelComponent;
    private confirmationPanelComponent: ConfirmationPanelComponent;

    // DOM Containers
    private mainEl: HTMLElement;
    private historyViewContainer: HTMLElement;
    private panelContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: VersionControlPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.store = plugin.store;
        this.icon = "history";
    }

    getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL;
    }

    getDisplayText(): string {
        return "Version Control";
    }

    async onOpen() {
        try {
            this.containerEl.addClass("version-control-view");
            this.contentEl.addClass("version-control-content");
            
            this.buildLayout();
            this.initComponents();

            this.unsubscribe = this.store.subscribe(() => this.render(this.store.getState()));
            // Initial render and data fetch
            this.render(this.store.getState());
            this.store.dispatch(thunks.updateActiveNote());
        } catch (error) {
            console.error("Version Control: Failed to open view.", error);
            this.contentEl.empty();
            const errorDiv = this.contentEl.createDiv({ cls: "v-placeholder is-active" });
            setIcon(errorDiv.createDiv({ cls: "v-placeholder-icon" }), "alert-triangle");
            errorDiv.createEl("p", { text: "An error occurred while opening the Version Control view." });
            errorDiv.createEl("p", { text: "Please check the developer console for more details.", cls: "v-meta-label" });
        }
    }

    async onClose() {
        // Unsubscribe from the store to prevent the closed view from reacting to state changes.
        this.unsubscribe?.();

        // Destroy all UI components to guarantee the release of all resources.
        // This includes DOM elements, event listeners, timers, and observers.
        this.placeholderComponent?.destroy();
        this.actionBarComponent?.destroy();
        this.settingsPanelComponent?.destroy();
        this.historyListComponent?.destroy();
        this.previewPanelComponent?.destroy();
        this.confirmationPanelComponent?.destroy();
    }

    private buildLayout() {
        this.contentEl.empty();
        this.mainEl = this.contentEl.createDiv("v-main");
        
        this.historyViewContainer = this.mainEl.createDiv({ cls: "v-history-view" });
        this.panelContainer = this.mainEl.createDiv({ cls: "v-panel-container" });
    }

    private initComponents() {
        this.placeholderComponent = new PlaceholderComponent(this.mainEl);

        const topContainer = this.historyViewContainer.createDiv();
        this.actionBarComponent = new ActionBarComponent(topContainer, this.plugin);
        this.settingsPanelComponent = new SettingsPanelComponent(topContainer, this.plugin);

        this.historyListComponent = new HistoryListComponent(this.historyViewContainer, this.plugin);

        this.previewPanelComponent = new PreviewPanelComponent(this.panelContainer, this.plugin);
        this.confirmationPanelComponent = new ConfirmationPanelComponent(this.panelContainer, this.plugin);
    }

    /**
     * Main render function, driven by state changes from the store.
     * It declaratively orchestrates what is visible on the screen based on the current AppState.
     * This function is the heart of the view's reactivity, ensuring the UI
     * is always a perfect reflection of the application state.
     */
    private render(state: AppState) {
        try {
            const { ui } = state;

            // Apply global processing class to lock UI during critical operations
            this.contentEl.classList.toggle('is-processing', ui.isProcessing);

            // Determine which main view should be visible
            const showHistory = ui.viewMode === 'history' || ui.viewMode === 'loading';
            const showPlaceholder = ui.viewMode === 'placeholder';

            // Toggle main view containers' visibility
            this.historyViewContainer.classList.toggle('is-active', showHistory);
            this.placeholderComponent.toggle(showPlaceholder);

            // Render content for visible main views
            if (showHistory) {
                this.actionBarComponent.render(state);
                this.settingsPanelComponent.render(state);
                this.historyListComponent.render(state);
            }
            if (showPlaceholder) {
                this.placeholderComponent.render();
            }

            // Handle overlay panels
            const isPanelOpen = ui.preview.isOpen || ui.confirmation.isOpen;
            this.panelContainer.classList.toggle('is-active', isPanelOpen);

            // Render and toggle the preview panel
            if (ui.preview.isOpen) {
                this.previewPanelComponent.render(state, this);
            }
            this.previewPanelComponent.toggle(ui.preview.isOpen);

            // Render and toggle the confirmation panel
            if (ui.confirmation.isOpen) {
                this.confirmationPanelComponent.render(state);
            }
            this.confirmationPanelComponent.toggle(ui.confirmation.isOpen);
        } catch (error) {
            console.error("Version Control: A critical error occurred during view rendering.", error);
            // Display an error message within the view itself to avoid a blank screen
            this.contentEl.empty();
            const errorDiv = this.contentEl.createDiv({ cls: "v-placeholder is-active" });
            setIcon(errorDiv.createDiv({ cls: "v-placeholder-icon" }), "alert-triangle");
            errorDiv.createEl("p", { text: "A critical error occurred while rendering the view." });
            errorDiv.createEl("p", { text: "Please try closing and reopening the view, or check the console.", cls: "v-meta-label" });
        }
    }
}