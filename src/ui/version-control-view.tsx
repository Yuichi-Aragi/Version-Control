import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import { VIEW_TYPE_VERSION_CONTROL } from "../constants";
import type { AppStore } from "../state/store";
import { actions } from "../state/appSlice";
import { VersionControlRoot } from "./components/VersionControlRoot";
import { AppContext } from "./AppContext";
import { TimeProvider } from "./contexts/TimeContext";

export class VersionControlView extends ItemView {
    store: AppStore;
    override app: App;
    private reactRoot: Root | null = null;
    private reactRootContainer: HTMLDivElement | null = null;

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
        
        // FIX: Create a wrapper for the React root that we can style reliably
        // to ensure a stable 100% height for the React layout engine. This is
        // critical for mobile viewport resizing with virtual keyboards, as it
        // provides a non-collapsing parent for the flexbox/height-based UI.
        this.reactRootContainer = this.contentEl.createDiv();
        this.reactRootContainer.style.height = '100%';
        
        this.reactRoot = createRoot(this.reactRootContainer);
        this.reactRoot.render(
            <StrictMode>
                <Provider store={this.store}>
                    <AppContext.Provider value={this.app}>
                        <TimeProvider>
                            <VersionControlRoot />
                        </TimeProvider>
                    </AppContext.Provider>
                </Provider>
            </StrictMode>
        );
    }

    override async onClose() {
        this.reactRoot?.unmount();
        
        const state = this.store.getState();
        // The changelog is a global notification. It should persist even if the view
        // is temporarily closed (e.g., by Obsidian on mobile to save resources).
        // Other panels are context-specific and should be cleared.
        if (state.panel?.type !== 'changelog') {
            this.store.dispatch(actions.closePanel());
        }
        
        this.store.dispatch(actions.clearDiffRequest());
        this.store.dispatch(actions.toggleSearch(false));
    }
}
