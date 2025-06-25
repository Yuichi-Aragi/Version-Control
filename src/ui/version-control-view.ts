import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import { Store } from "../state/store";
import { AppState, AppStatus } from "../state/state";

import { PlaceholderComponent } from "./components/PlaceholderComponent";
import { ActionBarComponent } from "./components/ActionBarComponent";
import { SettingsPanelComponent } from "./components/SettingsPanelComponent";
import { HistoryListComponent } from "./components/HistoryListComponent";
import { PreviewPanelComponent } from "./components/PreviewPanelComponent";
import { DiffPanelComponent } from "./components/DiffPanelComponent";
import { ConfirmationPanelComponent } from "./components/ConfirmationPanelComponent";
import { ErrorDisplayComponent } from "./components/ErrorDisplayComponent";

export class VersionControlView extends ItemView {
    store: Store;
    app: App;
    private unsubscribeFromStore: () => void;
    
    private placeholderComponent: PlaceholderComponent;
    private actionBarComponent: ActionBarComponent;
    private settingsPanelComponent: SettingsPanelComponent;
    private historyListComponent: HistoryListComponent;
    private previewPanelComponent: PreviewPanelComponent;
    private diffPanelComponent: DiffPanelComponent;
    private confirmationPanelComponent: ConfirmationPanelComponent;
    private errorDisplayComponent: ErrorDisplayComponent;

    private mainContainer: HTMLElement;
    private readyStateContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, store: Store, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "history";
    }

    getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL;
    }

    getDisplayText(): string {
        return "Version Control";
    }

    async onOpen() {
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

    async onClose() {
        if (this.unsubscribeFromStore) {
            this.unsubscribeFromStore();
        }
        // Components are now children of this view, they will be unloaded automatically.
        this.contentEl.empty();
    }

    private initComponents() {
        this.placeholderComponent = this.addChild(new PlaceholderComponent(this.mainContainer));
        this.errorDisplayComponent = this.addChild(new ErrorDisplayComponent(this.mainContainer, this.store, this.app));
        
        this.readyStateContainer = this.mainContainer.createDiv('v-ready-state-container');
        
        this.actionBarComponent = this.addChild(new ActionBarComponent(this.readyStateContainer, this.store));
        this.settingsPanelComponent = this.addChild(new SettingsPanelComponent(this.readyStateContainer, this.store));
        this.historyListComponent = this.addChild(new HistoryListComponent(this.readyStateContainer, this.store));
        
        this.previewPanelComponent = this.addChild(new PreviewPanelComponent(this.readyStateContainer, this.store, this.app));
        this.diffPanelComponent = this.addChild(new DiffPanelComponent(this.readyStateContainer, this.store));
        this.confirmationPanelComponent = this.addChild(new ConfirmationPanelComponent(this.readyStateContainer, this.store));
    }

    private render(state: AppState) {
        const isAppProcessing = state.status === AppStatus.READY && state.isProcessing;
        this.contentEl.classList.toggle('is-processing', isAppProcessing);

        const showPlaceholder = state.status === AppStatus.INITIALIZING || state.status === AppStatus.PLACEHOLDER;
        const showError = state.status === AppStatus.ERROR;
        const showReadyOrLoading = state.status === AppStatus.READY || state.status === AppStatus.LOADING;

        this.placeholderComponent.getContainer().toggle(showPlaceholder);
        this.errorDisplayComponent.getContainer().toggle(showError);
        this.readyStateContainer.toggle(showReadyOrLoading);

        switch (state.status) {
            case AppStatus.INITIALIZING:
                this.placeholderComponent.render("Initializing Version Control...", "sync");
                break;

            case AppStatus.PLACEHOLDER:
                this.placeholderComponent.render();
                break;

            case AppStatus.ERROR:
                this.errorDisplayComponent.render(state.error);
                break;

            case AppStatus.LOADING:
                this.actionBarComponent.getContainer().hide();
                this.settingsPanelComponent.getContainer().hide();
                this.previewPanelComponent.getContainer().hide();
                this.diffPanelComponent.getContainer().hide();
                this.confirmationPanelComponent.getContainer().hide();
                
                this.historyListComponent.renderAsLoading();
                this.historyListComponent.getContainer().show();
                break;

            case AppStatus.READY:
                this.actionBarComponent.getContainer().show();
                this.historyListComponent.getContainer().show();

                this.actionBarComponent.render(state);
                this.historyListComponent.render(state);
                
                this.settingsPanelComponent.render(state.panel?.type === 'settings', state);
                this.previewPanelComponent.render(state.panel?.type === 'preview' ? state.panel : null);
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
