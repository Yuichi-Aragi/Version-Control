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
        
        // Ensure we wait for layout to be ready before attempting to render React tree.
        // This prevents issues where the view is opened programmatically before Obsidian is fully loaded.
        this.app.workspace.onLayoutReady(() => {
            // PERF: Implement 2025 "Deferred View" optimization.
            // We defer the heavy React hydration until the main thread is idle.
            // This allows the sidebar animation (if triggered via revealLeaf) to complete
            // smoothly before we burn CPU cycles initializing the React tree.
            // This is critical for the "buttery smooth" feel when hydrating a DeferredView.
            
            // Defensive: Check for requestIdleCallback availability (Node/Electron should have it)
            const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));

            defer(() => {
                // Defensive: Ensure view hasn't been closed/unmounted in the meantime
                if (!this.reactRootContainer || !this.contentEl.contains(this.reactRootContainer)) return;

                try {
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
                } catch (e) {
                    console.error("Version Control: Failed to mount React root", e);
                    this.reactRootContainer.innerText = "Failed to load view. Check console.";
                }
            }, { timeout: 1000 });
        });
    }

    override async onClose() {
        try {
            if (this.reactRoot) {
                this.reactRoot.unmount();
                this.reactRoot = null;
            }
            this.reactRootContainer = null;
            
            // Defensive: Check store existence before dispatching
            if (this.store) {
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
        } catch (e) {
            console.error("Version Control: Error closing view", e);
        }
    }
}
