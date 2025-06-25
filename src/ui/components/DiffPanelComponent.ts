import { setIcon } from "obsidian";
import { Store } from "../../state/store";
import { DiffPanel as DiffPanelState } from "../../state/state";
import { actions } from "../../state/actions";
import { BasePanelComponent } from "./BasePanelComponent";
import { Change } from "diff";

export class DiffPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private lastRenderedKey: string | null = null;

    constructor(parent: HTMLElement, store: Store) {
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
            this.renderDiffLines(diffContentWrapper, diffChanges);
        }
    }

    private renderDiffLines(container: HTMLElement, changes: Change[]) {
        let oldLineNum = 1;
        let newLineNum = 1;
    
        for (const part of changes) {
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '') {
                lines.pop();
            }
    
            for (const line of lines) {
                const lineEl = container.createDiv({ cls: 'diff-line' });
                
                const prefixEl = lineEl.createDiv({ cls: 'diff-line-prefix' });
                const oldNumEl = lineEl.createDiv({ cls: 'diff-line-num old' });
                const newNumEl = lineEl.createDiv({ cls: 'diff-line-num new' });
                const contentEl = lineEl.createDiv({ cls: 'diff-line-content' });
                contentEl.setText(line || '\u00A0');
    
                if (part.added) {
                    lineEl.addClass('diff-add');
                    prefixEl.setText('+');
                    newNumEl.setText(String(newLineNum++));
                } else if (part.removed) {
                    lineEl.addClass('diff-remove');
                    prefixEl.setText('-');
                    oldNumEl.setText(String(oldLineNum++));
                } else {
                    lineEl.addClass('diff-context');
                    oldNumEl.setText(String(oldLineNum++));
                    newNumEl.setText(String(newLineNum++));
                }
            }
        }
    }

    onunload() {
        this.lastRenderedKey = null;
        super.onunload();
    }
}
