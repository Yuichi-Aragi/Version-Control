import { MarkdownRenderer, setIcon, App, moment, Component } from "obsidian";
import type { AppStore } from "../../state/store";
import type { PreviewPanel as PreviewPanelState, AppState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";

export class PreviewPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;
    private lastRenderedVersionId: string | undefined;
    private app: App;

    // New properties for markdown toggle
    private localRenderMarkdown: boolean = false;
    private previewContentEl: HTMLElement | null = null;
    private currentContent: string = "";
    private currentNotePath: string = "";

    constructor(parent: HTMLElement, store: AppStore, app: App) {
        super(parent, store, ["v-panel-container"]);
        // FIX: Add a unique class for the panel itself for consistent styling and structure.
        this.innerPanel = this.container.createDiv({ cls: "v-inline-panel v-preview-panel" });
        this.app = app;
    }

    render(panelState: PreviewPanelState | null, appState: AppState) {
        this.toggle(!!panelState);

        if (!panelState) {
            if (this.innerPanel.hasChildNodes()) {
                this.innerPanel.empty();
                this.lastRenderedVersionId = undefined;
                this.previewContentEl = null;
            }
            return;
        }
        
        // Render guard: only re-render if the version ID changes.
        if (this.lastRenderedVersionId === panelState.version.id && this.innerPanel.hasChildNodes()) {
            return;
        }
        this.lastRenderedVersionId = panelState.version.id;
        this.innerPanel.empty();

        // FIX: Create a content wrapper inside the panel to match the structure of other panels.
        const contentWrapper = this.innerPanel.createDiv("v-preview-panel-content");

        const { version, content } = panelState;
        this.currentContent = content; // Store content for re-rendering
        const settings = appState.settings; 
        this.currentNotePath = appState.file?.path ?? '';

        const header = contentWrapper.createDiv("v-panel-header");
        const versionLabel = version.name
            ? `V${version.versionNumber}: ${version.name}`
            : `Version ${version.versionNumber}`;
        const titleEl = header.createEl("h3", { text: versionLabel });
        titleEl.setAttribute("title", `Timestamp: ${moment(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`);

        const headerActions = header.createDiv('v-panel-header-actions');

        // Add markdown toggle button if setting is off
        if (!settings.renderMarkdownInPreview) {
            this.localRenderMarkdown = false; // Reset to plaintext view
            const toggleBtn = headerActions.createEl("button", {
                cls: "v-action-btn v-preview-toggle-btn",
                attr: { "aria-label": "Toggle markdown rendering", "title": "Toggle markdown rendering" }
            });
            setIcon(toggleBtn, "book-open"); // Icon to turn ON rendering
            toggleBtn.addEventListener("click", () => {
                this.localRenderMarkdown = !this.localRenderMarkdown;
                setIcon(toggleBtn, this.localRenderMarkdown ? "code" : "book-open");
                this.renderPreviewContent();
            });
        }

        const closeBtn = headerActions.createEl("button", { 
            cls: "clickable-icon v-panel-close", 
            attr: { "aria-label": "Close preview", "title": "Close preview" } 
        });
        setIcon(closeBtn, "x");
        closeBtn.addEventListener("click", () => {
            this.store.dispatch(actions.closePanel());
        });

        this.previewContentEl = contentWrapper.createDiv({ cls: "v-version-content-preview" });
        this.renderPreviewContent();
    }

    private renderPreviewContent() {
        if (!this.previewContentEl) return;
        this.previewContentEl.empty();
        
        const settings = this.store.getState().settings;
        const shouldRenderMarkdown = settings.renderMarkdownInPreview || this.localRenderMarkdown;

        try {
            if (shouldRenderMarkdown) {
                this.previewContentEl.removeClass('is-plaintext');
                MarkdownRenderer.render(
                    this.app, 
                    this.currentContent, 
                    this.previewContentEl, 
                    this.currentNotePath, 
                    this as Component
                );
            } else {
                this.previewContentEl.addClass('is-plaintext');
                this.previewContentEl.setText(this.currentContent);
            }
        } catch (error) {
            console.error("VC: Failed to render Markdown preview in panel.", error);
            this.previewContentEl.empty();
            this.previewContentEl.addClass('is-plaintext');
            this.previewContentEl.setText(this.currentContent);
            this.previewContentEl.createEl('p', { text: 'Failed to render markdown. Displaying as plain text.', cls: 'text-error' });
        }
    }

    override onunload() {
        this.lastRenderedVersionId = undefined;
        this.previewContentEl = null;
        super.onunload();
    }
}
