import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import type { AppStore } from "../state/store";
import { actions } from "../state/appSlice";
import { VersionControlRoot } from "./components/VersionControlRoot";
import { AppContext } from "./AppContext";

export class VersionControlView extends ItemView {
    store: AppStore;
    override app: App;
    private reactRoot: Root | null = null;

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
        
        this.reactRoot = createRoot(this.contentEl);
        this.reactRoot.render(
            <StrictMode>
                <Provider store={this.store}>
                    <AppContext.Provider value={this.app}>
                        <VersionControlRoot />
                    </AppContext.Provider>
                </Provider>
            </StrictMode>
        );
    }

    override async onClose() {
        this.reactRoot?.unmount();
        
        this.store.dispatch(actions.closePanel());
        this.store.dispatch(actions.clearDiffRequest());
        this.store.dispatch(actions.toggleSearch(false));
    }
}
