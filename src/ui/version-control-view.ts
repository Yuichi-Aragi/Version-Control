import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import type { AppStore } from "../state/store";
import { AppStatus, type AppState } from "../state/state";

import { PlaceholderComponent } from "./components/PlaceholderComponent";
import { ActionBarComponent } from "./components/ActionBarComponent";
import { SettingsPanelComponent } from "./components/SettingsPanelComponent";
import { HistoryListComponent } from "./components/HistoryListComponent";
import { PreviewPanelComponent } from "./components/PreviewPanelComponent";
import { DiffPanelComponent } from "./components/DiffPanelComponent";
import { ConfirmationPanelComponent } from "./components/ConfirmationPanelComponent";
import { ErrorDisplayComponent } from "./components/ErrorDisplayComponent";

export class VersionControlView extends ItemView {
    store: AppStore;
    override app: App;
    // Use definite assignment assertion '!' for all properties that are
    // correctly initialized in the `onOpen` lifecycle method, not the constructor.
    private unsubscribeFromStore!: () => void;
    
    private placeholderComponent!: PlaceholderComponent;
    private actionBarComponent!: ActionBarComponent;
    private settingsPanelComponent!: SettingsPanelComponent;
    private historyListComponent!: HistoryListComponent;
    private previewPanelComponent!: PreviewPanelComponent;
    private diffPanelComponent!: DiffPanelComponent;
    private confirmationPanelComponent!: ConfirmationPanelComponent;
    private errorDisplayComponent!: ErrorDisplayComponent;

    private mainContainer!: HTMLElement;
    private readyStateContainer!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, store: AppStore, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "history";
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL;
    }

    override getDisplayText(): string {
        return "Version control";
    }

    override async onOpen() {
        this.containerEl.addClass("version-control-view");
        this.contentEl.addClass("version-control-content");
        
        this.mainContainer = this.contentEl.createDiv("v-main");

        this.initComponents();

        this.unsubscribeFromStore = this.store.subscribe(() => {
            if (this.leaf.parent) {
                this.render(this.store.getState());
            }
        });
        
        this.render(this.store.getState());
    }

    override async onClose() {
        if (this.unsubscribeFromStore) {
            this.unsubscribeFromStore();
        }
        // Components are now children of this view, and they will be unloaded automatically
        // by the base Component's `unload` method. Their own `onunload` methods
        // will handle removing their DOM elements. We should not call `empty()` here
        // as it can cause errors if child components try to access their DOM during unload.
    }

    private initComponents() {
        // Action bar is a direct child of mainContainer, initialized first.
        this.actionBarComponent = this.addChild(new ActionBarComponent(this.mainContainer, this.store));
        
        this.placeholderComponent = this.addChild(new PlaceholderComponent(this.mainContainer));
        this.errorDisplayComponent = this.addChild(new ErrorDisplayComponent(this.mainContainer, this.store, this.app));
        
        // readyStateContainer now holds only the history list.
        this.readyStateContainer = this.mainContainer.createDiv('v-ready-state-container');
        
        this.historyListComponent = this.addChild(new HistoryListComponent(this.readyStateContainer, this.store));
        
        // All panels are now children of mainContainer to overlay the ready state.
        this.settingsPanelComponent = this.addChild(new SettingsPanelComponent(this.mainContainer, this.store));
        this.previewPanelComponent = this.addChild(new PreviewPanelComponent(this.mainContainer, this.store, this.app));
        this.diffPanelComponent = this.addChild(new DiffPanelComponent(this.mainContainer, this.store));
        this.confirmationPanelComponent = this.addChild(new ConfirmationPanelComponent(this.mainContainer, this.store));
    }

    private render(state: AppState) {
        // Hide all major components by default and selectively show them.
        this.placeholderComponent.getContainer().hide();
        this.errorDisplayComponent.getContainer().hide();
        this.actionBarComponent.getContainer().hide();
        this.readyStateContainer.hide();

        // An overlay that covers the action bar is considered a "full" overlay.
        // The settings panel is a partial overlay and should not trigger this.
        const isFullOverlayPanelVisible = state.panel && (state.panel.type === 'preview' || state.panel.type === 'diff' || state.panel.type === 'confirmation');
        const isAppBusy = isFullOverlayPanelVisible || (state.status === AppStatus.READY && state.isProcessing);
        this.contentEl.classList.toggle('is-overlay-active', isAppBusy);

        switch (state.status) {
            case AppStatus.INITIALIZING:
                this.placeholderComponent.render("Initializing version control...", "sync");
                this.placeholderComponent.getContainer().show();
                break;

            case AppStatus.PLACEHOLDER:
                this.placeholderComponent.render(); // Renders default "Open a note..." message
                this.placeholderComponent.getContainer().show();
                break;

            case AppStatus.ERROR:
                this.errorDisplayComponent.render(state.error);
                this.errorDisplayComponent.getContainer().show();
                break;

            case AppStatus.LOADING:
                // In loading state, we show the container for the skeleton list
                this.readyStateContainer.show();
                this.historyListComponent.renderAsLoading(state.settings); // Pass settings for accurate skeleton
                // Ensure all overlay panels are hidden
                this.settingsPanelComponent.render(null, state);
                this.previewPanelComponent.render(null, state);
                this.diffPanelComponent.render(null);
                this.confirmationPanelComponent.render(null);
                break;

            case AppStatus.READY:
                // Action bar is now always visible in READY state.
                // Its interactivity is controlled by the `is-overlay-active` class on `contentEl`.
                this.actionBarComponent.getContainer().show();
                this.actionBarComponent.render(state);

                if (state.history.length === 0) {
                    // Active note, but no versions. Show a specific placeholder.
                    this.placeholderComponent.render("No versions saved yet.", "inbox");
                    this.placeholderComponent.getContainer().show();
                } else {
                    // Active note with versions. Show the history list.
                    this.readyStateContainer.show();
                    this.historyListComponent.getContainer().show();
                    this.historyListComponent.render(state);
                }
                
                // Render all overlay panels. They will manage their own visibility.
                this.settingsPanelComponent.render(state.panel?.type === 'settings' ? state.panel : null, state);
                this.previewPanelComponent.render(state.panel?.type === 'preview' ? state.panel : null, state);
                this.diffPanelComponent.render(state.panel?.type === 'diff' ? state.panel : null);
                this.confirmationPanelComponent.render(state.panel?.type === 'confirmation' ? state.panel : null);
                break;
            
            default:
                console.error("Version Control: Unknown AppStatus in render:", state);
                this.placeholderComponent.render("An unexpected error occurred in the view.", "alert-circle");
                this.placeholderComponent.getContainer().show();
        }
    }
}
