import { ItemView, WorkspaceLeaf, moment, App } from "obsidian";
import { VIEW_TYPE_VERSION_DIFF } from "../constants";
import type { AppStore } from "../state/store";
// FIX: Removed unused 'VersionHistoryEntry' and 'DiffTarget' imports.
// Their types are correctly inferred from DiffViewDisplayState.
import type { DiffViewDisplayState } from "../types";
import { renderDiffLines } from "./utils/diff-renderer";

export class VersionDiffView extends ItemView {
    store: AppStore;
    app: App;
    private currentDisplayState: DiffViewDisplayState | null = null;
    private tabContentEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, store: AppStore, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "diff";
    }

    getViewType(): string {
        return VIEW_TYPE_VERSION_DIFF;
    }

    getDisplayText(): string {
        if (this.currentDisplayState) {
            const { version1, version2, noteName } = this.currentDisplayState;
            const v1Label = `V${version1.versionNumber}`;
            
            // FIX: Use a proper type guard to safely access properties on the 'version2' DiffTarget.
            let v2Label: string;
            if ('versionNumber' in version2) {
                // TypeScript now knows version2 is a VersionHistoryEntry
                v2Label = `V${version2.versionNumber}`;
            } else {
                v2Label = 'Current';
            }
            
            return `Diff: ${noteName} (${v2Label} vs ${v1Label})`;
        }
        return "Version Diff";
    }

    async setState(state: any, options: any): Promise<void> {
        await super.setState(state, options);

        if (state && state.version1 && state.version2 && state.diffChanges) {
            this.currentDisplayState = state as DiffViewDisplayState;
            if (this.tabContentEl) {
                this.render();
            }
            // FIX: Use the correct API to request a header update.
            // 'requestUpdateLayout' does not exist. 'trigger("layout-change")' is the
            // correct way to ask Obsidian to re-evaluate view titles.
            this.app.workspace.trigger("layout-change");
        }
    }

    async onOpen() {
        this.containerEl.addClass("version-diff-view");
        this.tabContentEl = this.contentEl.createDiv("v-tab-view-content"); // Use semantic class
        
        if (this.currentDisplayState) {
            this.render();
        } else {
            this.renderPlaceholder();
        }
    }

    async onClose() {
        this.contentEl.empty();
        this.currentDisplayState = null;
        this.tabContentEl = null;
    }

    private render() {
        if (!this.tabContentEl || !this.currentDisplayState) return;
        this.tabContentEl.empty();

        const { version1, version2, diffChanges, noteName } = this.currentDisplayState;

        // Header
        const headerEl = this.tabContentEl.createDiv("v-panel-header");
        const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
        
        // FIX: Use a type guard to safely construct the label for 'version2' (DiffTarget).
        let v2Label: string;
        if ('versionNumber' in version2) {
            // TypeScript now knows version2 is a VersionHistoryEntry
            v2Label = version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`;
        } else {
            v2Label = 'Current Note State';
        }
        
        headerEl.createEl("h3", { text: `Comparing versions of "${noteName}"` });
        headerEl.createDiv({
            text: `Base (Red, -): ${v1Label} - ${moment(version1.timestamp).format('LLL')}`,
            cls: "v-meta-label"
        });
        headerEl.createDiv({
            // FIX: Use the same type guard to safely access the timestamp.
            text: `Compared (Green, +): ${v2Label} - ${'versionNumber' in version2 ? moment(version2.timestamp).format('LLL') : 'Now'}`,
            cls: "v-meta-label"
        });

        // Diff Content
        const diffContentWrapper = this.tabContentEl.createDiv({ cls: "v-diff-content-wrapper" });
        renderDiffLines(diffContentWrapper, diffChanges);
    }

    private renderPlaceholder() {
        if (!this.tabContentEl) return;
        this.tabContentEl.empty();
        this.tabContentEl.setText("No diff data to display. Open a diff from the Version Control panel.");
    }
}
