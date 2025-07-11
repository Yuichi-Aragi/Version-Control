import { setIcon } from "obsidian";
import { AppStore } from "../../state/store";
import { DiffPanel as DiffPanelState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";
// FIX: Removed unused 'Change' import to resolve TS6133 error.
import { renderDiffLines } from "../utils/diff-renderer";

export class DiffPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private lastRenderedKey: string | null = null;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container"]);
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
        const v1Label = version1.name ? `"${version1.name}"` : `V${version1.versionNumber}`;
        const v2Label = version2.id === 'current' ? 'Current Note' : (version2.name ? `"${version2.name}"` : `V${(version2 as any).versionNumber}`);
        header.createEl("h3", { text: `Diff: ${v2Label} vs ${v1Label}` });

        const closeBtn = header.createEl("button", { 
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
            const diffContentWrapper = contentWrapper.createDiv({ cls: "v-diff-content-wrapper" });
            renderDiffLines(diffContentWrapper, diffChanges);
        }
    }

    onunload() {
        this.lastRenderedKey = null;
        super.onunload();
    }
}
