import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import type { AppStore } from "../state/store";
import { AppStatus, type AppState } from "../state/state";
import { actions } from "../state/appSlice";

import { PlaceholderComponent } from "./components/PlaceholderComponent";
import { ActionBarComponent } from "./components/ActionBarComponent";
import { SettingsPanelComponent } from "./components/SettingsPanelComponent";
import { HistoryListComponent } from "./components/HistoryListComponent";
import { PreviewPanelComponent } from "./components/PreviewPanelComponent";
import { DiffPanelComponent } from "./components/DiffPanelComponent";
import { ConfirmationPanelComponent } from "./components/ConfirmationPanelComponent";
import { ErrorDisplayComponent } from "./components/ErrorDisplayComponent";
import { ActionPanelComponent } from "./components/ActionPanelComponent";

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
    private actionPanelComponent!: ActionPanelComponent;

    private mainContainer!: HTMLElement;
    private readyStateContainer!: HTMLElement;
    private topContainer!: HTMLElement;

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
        
        // This container holds the action bar and settings panel, which are always at the top.
        this.topContainer = this.contentEl.createDiv('v-top-container');
        
        // This container holds the main content that appears below the action bar.
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

        // Dispatch actions to clean up UI-specific state that should not persist
        // when the view is closed. This prevents stale panels, search states,
        // or diff indicators from appearing if the view is reopened for the same note.
        this.store.dispatch(actions.closePanel());
        this.store.dispatch(actions.clearDiffRequest());
        this.store.dispatch(actions.toggleSearch(false));

        // Child components are unloaded automatically by the base Component's `unload` method.
        // Their own `onunload` methods handle removing their DOM elements.
    }

    private initComponents() {
        // Action bar and settings panel are in the top container.
        this.actionBarComponent = this.addChild(new ActionBarComponent(this.topContainer, this.store));
        this.settingsPanelComponent = this.addChild(new SettingsPanelComponent(this.topContainer, this.store));
        
        // Placeholders and ready state are in the main container.
        this.placeholderComponent = this.addChild(new PlaceholderComponent(this.mainContainer));
        this.errorDisplayComponent = this.addChild(new ErrorDisplayComponent(this.mainContainer, this.store));
        
        this.readyStateContainer = this.mainContainer.createDiv('v-ready-state-container');
        
        this.historyListComponent = this.addChild(new HistoryListComponent(this.readyStateContainer, this.store));
        
        // Overlay panels are direct children of the content element to cover everything.
        this.previewPanelComponent = this.addChild(new PreviewPanelComponent(this.contentEl, this.store, this.app));
        this.diffPanelComponent = this.addChild(new DiffPanelComponent(this.contentEl, this.store));
        this.confirmationPanelComponent = this.addChild(new ConfirmationPanelComponent(this.contentEl, this.store));
        this.actionPanelComponent = this.addChild(new ActionPanelComponent(this.contentEl, this.store));
    }

    private render(state: AppState) {
        // Hide all major components by default and selectively show them.
        this.placeholderComponent.getContainer().hide();
        this.errorDisplayComponent.getContainer().hide();
        this.actionBarComponent.getContainer().hide();
        this.readyStateContainer.hide();

        // An overlay panel is any panel that is not null. This simplifies logic and
        // ensures consistent behavior for all panel types.
        const isOverlayPanelVisible = state.panel !== null;
        
        // The main content area is considered busy if an overlay is active OR if the app is processing.
        // This class is used to disable pointer events on the action bar and history list, preventing click-through.
        const isContentBusy = isOverlayPanelVisible || (state.status === AppStatus.READY && (state.isProcessing || state.isRenaming));
        this.contentEl.classList.toggle('is-overlay-active', isContentBusy);
        this.contentEl.classList.toggle('is-processing', state.isProcessing || state.isRenaming);

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
                this.actionBarComponent.getContainer().show();
                this.actionBarComponent.render(state);
                this.readyStateContainer.show();
                this.historyListComponent.renderAsLoading(state.settings); // Pass settings for accurate skeleton
                // Ensure all overlay panels are hidden
                this.settingsPanelComponent.render(null, state);
                this.previewPanelComponent.render(null, state);
                this.diffPanelComponent.render(null);
                this.confirmationPanelComponent.render(null);
                this.actionPanelComponent.render(null);
                break;

            case AppStatus.READY:
                this.actionBarComponent.getContainer().show();
                this.actionBarComponent.render(state);

                if (state.history.length === 0 && !state.noteId) {
                    // Active note, but no versions. Show a specific placeholder.
                    this.placeholderComponent.render("No versions saved yet.", "inbox");
                    this.placeholderComponent.getContainer().show();
                } else {
                    // Active note with versions. Show the history list.
                    this.readyStateContainer.show();
                    this.historyListComponent.render(state);
                }
                
                // Render all overlay panels. They will manage their own visibility.
                this.settingsPanelComponent.render(state.panel?.type === 'settings' ? state.panel : null, state);
                this.previewPanelComponent.render(state.panel?.type === 'preview' ? state.panel : null, state);
                this.diffPanelComponent.render(state.panel?.type === 'diff' ? state.panel : null);
                this.confirmationPanelComponent.render(state.panel?.type === 'confirmation' ? state.panel : null);
                this.actionPanelComponent.render(state.panel?.type === 'action' ? state.panel : null);
                break;
            
            default:
                console.error("Version Control: Unknown AppStatus in render:", state);
                this.placeholderComponent.render("An unexpected error occurred in the view.", "alert-circle");
                this.placeholderComponent.getContainer().show();
        }
    }
}
