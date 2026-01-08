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
    private idleCallbackId: number | null = null;

    constructor(leaf: WorkspaceLeaf, public store: AppStore) {
        super(leaf);
        this.icon = "history";
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL;
    }

    override getDisplayText(): string {
        return "Version control";
    }

    override async onOpen(): Promise<void> {
        // Prepare the container element
        this.contentEl.empty();
        this.contentEl.addClass("version-control-view");
        
        // Use an inner container for React to avoid conflict with Obsidian's UI elements
        const container = this.contentEl.createDiv({
            cls: "version-control-react-root",
        });

        // Best Practice: Ensure workspace is ready before mounting complex UI
        this.app.workspace.onLayoutReady(() => {
            this.mountReact(container);
        });
    }

    private mountReact(container: HTMLElement): void {
        // Safety: ensure we haven't already mounted or the leaf isn't closing
        if (this.reactRoot || !this.contentEl.contains(container)) return;

        const schedule = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1));
        
        this.idleCallbackId = schedule(() => {
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
            }
        }, { timeout: 1000 });
    }

    override async onClose(): Promise<void> {
        // 1. Cancel pending mounts immediately
        if (this.idleCallbackId !== null) {
            const cancel = (window as any).cancelIdleCallback || clearTimeout;
            cancel(this.idleCallbackId);
            this.idleCallbackId = null;
        }

        // 2. Unmount React BEFORE clearing DOM to allow React cleanups to run
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }

        // 3. Perform Redux cleanup as requested
        this.cleanupState();

        // 4. Clear DOM (Obsidian will handle leaf detachment)
        this.contentEl.empty();
        
        return super.onClose();
    }

    private cleanupState(): void {
        if (!this.store) return;
        const state = this.store.getState();
        
        // Preserve global panels, clear local context panels
        if (state.app.panel?.type !== "changelog") {
            this.store.dispatch(appSlice.actions.closePanel());
        }
        
        this.store.dispatch(appSlice.actions.clearDiffRequest());
        this.store.dispatch(appSlice.actions.toggleSearch(false));
    }
}
