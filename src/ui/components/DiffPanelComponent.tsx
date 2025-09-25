import { setIcon } from "obsidian";
import type { AppStore } from "../../state/store";
import type { DiffPanel as DiffPanelState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VirtualizedDiff } from "./shared/react/VirtualizedDiff";

export class DiffPanelComponent extends BasePanelComponent {
    private lastRenderedKey: string | null = null;
    private reactRoot: Root | null = null;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container"]);
    }

    private unmountReactRoot() {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }

    render(panelState: DiffPanelState | null) {
        this.toggle(!!panelState);

        if (!panelState) {
            this.unmountReactRoot();
            this.container.empty();
            this.lastRenderedKey = null;
            return;
        }

        const { version1, version2, diffChanges } = panelState;
        const renderKey = `${version1.id}:${version2.id}:${diffChanges !== null}`;

        if (this.lastRenderedKey === renderKey) {
            return;
        }
        
        this.unmountReactRoot();
        this.container.empty();
        this.lastRenderedKey = renderKey;

        const innerPanel = this.container.createDiv({ cls: "v-inline-panel v-diff-panel" });

        const header = innerPanel.createDiv("v-panel-header");
        
        header.createEl("h3", { text: `Comparing versions` });

        const headerActions = header.createDiv('v-panel-header-actions');
        const closeBtn = headerActions.createEl("button", { 
            cls: "clickable-icon v-panel-close", 
            attr: { "aria-label": "Close diff", "title": "Close diff" } 
        });
        setIcon(closeBtn, "x");
        closeBtn.addEventListener("click", () => {
            this.store.dispatch(actions.closePanel());
            // FIX: Also clear the diff request state. This "consumes" the diff,
            // ensuring the indicator in the action bar disappears as expected.
            this.store.dispatch(actions.clearDiffRequest());
        });

        const contentWrapper = innerPanel.createDiv("v-diff-panel-content");

        if (diffChanges === null) {
            contentWrapper.addClass('is-loading');
            contentWrapper.createDiv({ cls: 'loading-spinner' });
            contentWrapper.createEl('p', { text: 'Loading diff...' });
        } else {
            const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
            let v2Label: string;
            if (version2.id === 'current') {
                v2Label = 'Current note state';
            } else if ('versionNumber' in version2) {
                v2Label = version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`;
            } else {
                v2Label = version2.name;
            }

            const metaContainer = contentWrapper.createDiv({ cls: 'v-diff-meta-container' });
            metaContainer.createDiv({
                text: `Base (red, -): ${v1Label}`,
                cls: "v-meta-label"
            });
            metaContainer.createDiv({
                text: `Compared (green, +): ${v2Label}`,
                cls: "v-meta-label"
            });
            
            const diffContentWrapper = contentWrapper.createDiv({ cls: "v-diff-content-wrapper" });
            this.reactRoot = createRoot(diffContentWrapper);
            this.reactRoot.render(
                <React.StrictMode>
                    <VirtualizedDiff changes={diffChanges} />
                </React.StrictMode>
            );
        }
    }

    override onunload() {
        this.unmountReactRoot();
        this.lastRenderedKey = null;
        super.onunload();
    }
}
