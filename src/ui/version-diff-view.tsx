import { ItemView, WorkspaceLeaf, App } from "obsidian";
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import { VIEW_TYPE_VERSION_DIFF } from "../constants";
import type { AppStore } from "../state/store";
import type { DiffViewDisplayState } from "../types";
import { VersionDiffRoot } from "./components/VersionDiffRoot";
import { AppContext } from "./AppContext";

export class VersionDiffView extends ItemView {
    store: AppStore;
    override app: App;
    private reactRoot: Root | null = null;
    private currentDisplayState: DiffViewDisplayState | null = null;

    constructor(leaf: WorkspaceLeaf, store: AppStore, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "diff";
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_DIFF;
    }

    override getDisplayText(): string {
        if (this.currentDisplayState) {
            const { version1, version2, noteName } = this.currentDisplayState;
            const v1Label = `V${version1.versionNumber}`;
            
            let v2Label: string;
            if ('versionNumber' in version2) {
                v2Label = `V${version2.versionNumber}`;
            } else {
                v2Label = 'Current';
            }
            
            return `Diff: ${noteName} (${v1Label} vs ${v2Label})`;
        }
        return "Version diff";
    }

    override async setState(state: any, options: any): Promise<void> {
        await super.setState(state, options);

        if (state && state.version1 && state.version2 && state.diffChanges && state.content1 && state.content2) {
            this.currentDisplayState = state as DiffViewDisplayState;
            this.render();
            this.app.workspace.trigger("layout-change");
        }
    }

    override async onOpen() {
        this.containerEl.addClass("version-diff-view");
        this.reactRoot = createRoot(this.contentEl);
        this.render();
    }

    override async onClose() {
        this.reactRoot?.unmount();
        this.currentDisplayState = null;
    }

    private render() {
        if (!this.reactRoot) return;

        this.reactRoot.render(
            <StrictMode>
                <Provider store={this.store}>
                    <AppContext.Provider value={this.app}>
                        <VersionDiffRoot displayState={this.currentDisplayState} />
                    </AppContext.Provider>
                </Provider>
            </StrictMode>
        );
    }
}
