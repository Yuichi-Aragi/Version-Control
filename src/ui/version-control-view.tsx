import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import { VIEW_TYPE_VERSION_CONTROL } from '@/constants';
import type { AppStore } from '@/state';
import { appSlice } from '@/state';
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
        // to ensure a stable 100% height for the React layout engine.
        this.reactRootContainer = this.contentEl.createDiv();
        this.reactRootContainer.style.height = '100%';
        
        // PERF: Implement 2025 "Deferred View" optimization.
        // We defer the heavy React hydration until the main thread is idle.
        // This allows the sidebar animation (if triggered via revealLeaf) to complete
        // smoothly before we burn CPU cycles initializing the React tree.
        // This is critical for the "buttery smooth" feel when hydrating a DeferredView.
        window.requestIdleCallback(() => {
            if (!this.reactRootContainer) return;

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
        }, { timeout: 1000 });
    }

    override async onClose() {
        this.reactRoot?.unmount();
        
        const state = this.store.getState();
        // The changelog is a global notification. It should persist even if the view
        // is temporarily closed (e.g., by Obsidian on mobile to save resources).
        // Other panels are context-specific and should be cleared.
        if (state.app.panel?.type !== 'changelog') {
            this.store.dispatch(appSlice.actions.closePanel());
        }
        
        this.store.dispatch(appSlice.actions.clearDiffRequest());
        this.store.dispatch(appSlice.actions.toggleSearch(false));
    }
}
