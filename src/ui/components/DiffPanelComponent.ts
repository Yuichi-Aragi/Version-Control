import { setIcon } from "obsidian";
import type { AppStore } from "../../state/store";
import type { DiffPanel as DiffPanelState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";
import { renderDiffLines } from "../utils/diff-renderer";

export class DiffPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private lastRenderedKey: string | null = null;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container"]);
        // FIX: Add a specific class to the panel for targeted styling.
        this.innerPanel = this.container.createDiv({ cls: "v-inline-panel v-diff-panel" });
    }

    render(panelState: DiffPanelState | null) {
        this.toggle(!!panelState);

        if (!panelState) {
            if (this.innerPanel.hasChildNodes()) {
                this.innerPanel.empty();
                this.lastRenderedKey = null;
            }
            return;
        }

        const { version1, version2, diffChanges } = panelState;
        const renderKey = `${version1.id}:${version2.id}:${diffChanges !== null}`;

        if (this.lastRenderedKey === renderKey) {
            return;
        }
        this.lastRenderedKey = renderKey;
        this.innerPanel.empty();

        const header = this.innerPanel.createDiv("v-panel-header");
        
        header.createEl("h3", { text: `Comparing Versions` });

        const headerActions = header.createDiv('v-panel-header-actions');
        const closeBtn = headerActions.createEl("button", { 
            cls: "clickable-icon v-panel-close", 
            attr: { "aria-label": "Close diff", "title": "Close diff" } 
        });
        setIcon(closeBtn, "x");
        closeBtn.addEventListener("click", () => {
            this.store.dispatch(actions.closePanel());
        });

        const contentWrapper = this.innerPanel.createDiv("v-diff-panel-content");

        if (diffChanges === null) {
            contentWrapper.addClass('is-loading');
            contentWrapper.createDiv({ cls: 'loading-spinner' });
            contentWrapper.createEl('p', { text: 'Loading diff...' });
        } else {
            const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
            let v2Label: string;
            if (version2.id === 'current') {
                v2Label = 'Current Note State';
            } else if ('versionNumber' in version2) {
                v2Label = version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`;
            } else {
                v2Label = version2.name;
            }

            // Add descriptive labels for clarity, similar to the dedicated diff view
            const metaContainer = contentWrapper.createDiv({ cls: 'v-diff-meta-container' });
            metaContainer.createDiv({
                text: `Base (Red, -): ${v1Label}`,
                cls: "v-meta-label"
            });
            metaContainer.createDiv({
                text: `Compared (Green, +): ${v2Label}`,
                cls: "v-meta-label"
            });
            
            const diffContentWrapper = contentWrapper.createDiv({ cls: "v-diff-content-wrapper" });
            renderDiffLines(diffContentWrapper, diffChanges);
        }
    }

    override onunload() {
        this.lastRenderedKey = null;
        super.onunload();
    }
}
