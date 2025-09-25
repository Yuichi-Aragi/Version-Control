import { MarkdownRenderer, setIcon, App, moment, Component } from "obsidian";
import type { AppStore } from "../../state/store";
import type { PreviewPanel as PreviewPanelState, AppState } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VirtualizedPlaintext } from "./shared/react/VirtualizedPlaintext";

export class PreviewPanelComponent extends BasePanelComponent {
    private lastRenderedVersionId: string | undefined;
    private app: App;
    private reactRoot: Root | null = null;

    // New properties for markdown toggle
    private localRenderMarkdown: boolean = false;
    private previewContentEl: HTMLElement | null = null;
    private currentContent: string = "";
    private currentNotePath: string = "";

    constructor(parent: HTMLElement, store: AppStore, app: App) {
        super(parent, store, ["v-panel-container"]);
        this.app = app;
    }

    private unmountReactRoot() {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }

    render(panelState: PreviewPanelState | null, appState: AppState) {
        this.toggle(!!panelState);

        if (!panelState) {
            this.unmountReactRoot();
            this.container.empty();
            this.lastRenderedVersionId = undefined;
            this.previewContentEl = null;
            return;
        }
        
        if (this.lastRenderedVersionId === panelState.version.id && this.container.hasChildNodes()) {
            return;
        }

        this.unmountReactRoot();
        this.container.empty();
        this.lastRenderedVersionId = panelState.version.id;

        const innerPanel = this.container.createDiv({ cls: "v-inline-panel v-preview-panel" });
        const contentWrapper = innerPanel.createDiv("v-preview-panel-content");

        const { version, content } = panelState;
        this.currentContent = content;
        const settings = appState.settings; 
        this.currentNotePath = appState.file?.path ?? '';

        const header = contentWrapper.createDiv("v-panel-header");
        const versionLabel = version.name
            ? `V${version.versionNumber}: ${version.name}`
            : `Version ${version.versionNumber}`;
        const titleEl = header.createEl("h3", { text: versionLabel });
        titleEl.setAttribute("title", `Timestamp: ${moment(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`);

        const headerActions = header.createDiv('v-panel-header-actions');

        if (!settings.renderMarkdownInPreview) {
            this.localRenderMarkdown = false;
            const toggleBtn = headerActions.createEl("button", {
                cls: "v-action-btn v-preview-toggle-btn",
                attr: { "aria-label": "Toggle markdown rendering", "title": "Toggle markdown rendering" }
            });
            setIcon(toggleBtn, "book-open");
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
        
        const settings = this.store.getState().settings;
        const shouldRenderMarkdown = settings.renderMarkdownInPreview || this.localRenderMarkdown;

        try {
            if (shouldRenderMarkdown) {
                this.unmountReactRoot();
                this.previewContentEl.empty();
                this.previewContentEl.removeClass('is-plaintext');
                MarkdownRenderer.render(
                    this.app, 
                    this.currentContent, 
                    this.previewContentEl, 
                    this.currentNotePath, 
                    this as Component
                );
            } else {
                this.previewContentEl.empty();
                this.previewContentEl.addClass('is-plaintext');
                this.reactRoot = createRoot(this.previewContentEl);
                this.reactRoot.render(
                    <React.StrictMode>
                        <VirtualizedPlaintext content={this.currentContent} />
                    </React.StrictMode>
                );
            }
        } catch (error) {
            console.error("VC: Failed to render Markdown preview in panel.", error);
            this.unmountReactRoot();
            this.previewContentEl.empty();
            this.previewContentEl.addClass('is-plaintext');
            this.previewContentEl.setText(this.currentContent);
            this.previewContentEl.createEl('p', { text: 'Failed to render markdown. Displaying as plain text.', cls: 'text-error' });
        }
    }

    override onunload() {
        this.unmountReactRoot();
        this.lastRenderedVersionId = undefined;
        this.previewContentEl = null;
        super.onunload();
    }
}