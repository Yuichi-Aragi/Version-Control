import { ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import { StrictMode } from "react";

import { VIEW_TYPE_VERSION_CONTROL } from "@/constants";
import type { AppStore } from "@/state";
import { appSlice } from "@/state";
import { VersionControlRoot } from "./components/VersionControlRoot";
import { AppContext } from "./AppContext";
import { TimeProvider } from "./contexts/TimeContext";

export class VersionControlView extends ItemView {
    private reactRoot: Root | null = null;

    constructor(leaf: WorkspaceLeaf, public store: AppStore) {
        super(leaf);
        this.icon = "history";
        this.register(() => this.cleanup()); // Auto-cleanup on view destruction [web:3]
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL;
    }

    override getDisplayText(): string {
        return "Version control";
    }

    override async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass("version-control-view");
        
        const container = this.contentEl.createDiv({
            cls: "version-control-react-root",
        });

        // Wait for layout ready, then microtask for optimal timing
        this.app.workspace.onLayoutReady(() => {
            queueMicrotask(() => this.mountReact(container));
        });
    }

    private mountReact(container: HTMLElement): void {
        if (this.reactRoot || !this.contentEl.isConnected || !this.contentEl.contains(container)) {
            return;
        }

        try {
            this.reactRoot = createRoot(container);
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
            console.error("Version Control: React Mount Error", e);
            container.createEl("div", { 
                text: "Failed to load version control view. Check console.",
                cls: "version-control-error"
            });
        }
    }

    override async onClose(): Promise<void> {
        await this.cleanup();
        this.contentEl.empty();
        return super.onClose();
    }

    private async cleanup(): Promise<void> {
        // Unmount React first for proper cleanup
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }

        // Guarded Redux cleanup
        if (this.store) {
            const state = this.store.getState();
            if (state.app.panel?.type !== "changelog") {
                this.store.dispatch(appSlice.actions.closePanel());
            }
            this.store.dispatch(appSlice.actions.clearDiffRequest());
            this.store.dispatch(appSlice.actions.toggleSearch(false));
        }
    }
}
