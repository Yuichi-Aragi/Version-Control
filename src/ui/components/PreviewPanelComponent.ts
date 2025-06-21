import { MarkdownRenderer, setIcon, Component, Notice } from "obsidian";
import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";
import { actions } from "../../state/actions";
import { BasePanelComponent } from "./BasePanelComponent";

export class PreviewPanelComponent extends BasePanelComponent {
    constructor(parent: HTMLElement, plugin: VersionControlPlugin) {
        super(parent, plugin, ["v-inline-panel", "v-preview-panel"]);
    }

    render(state: AppState, renderContext: Component) {
        this.container.empty();
        const { version, content } = state.ui.preview;
        const { file } = state.activeNote;

        if (!version || content === null) return;

        const header = this.container.createDiv("v-panel-header");
        const backBtn = header.createEl("button", { cls: "mod-cta" });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => this.plugin.store.dispatch(actions.hidePreview()));
        header.createEl("h3", { text: `Previewing V${version.versionNumber}` });

        const previewContentEl = this.container.createDiv({ cls: "v-version-content-preview" });
        
        try {
            if (state.settings.renderMarkdownInPreview) {
                // Use the passed-in renderContext (the VersionControlView instance)
                // for correct rendering of links and embeds within the plugin's lifecycle.
                MarkdownRenderer.render(this.plugin.app, content, previewContentEl, file?.path ?? '', renderContext);
            } else {
                previewContentEl.addClass('is-plaintext');
                previewContentEl.setText(content);
            }
        } catch (error) {
            console.error("Version Control: Failed to render Markdown preview.", error);
            new Notice("Failed to render Markdown. Displaying as plain text.");
            previewContentEl.empty();
            previewContentEl.addClass('is-plaintext');
            previewContentEl.setText(content);
        }
    }
}