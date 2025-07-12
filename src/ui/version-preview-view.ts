import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component, moment, TFile, App, setIcon } from "obsidian";
import { VIEW_TYPE_VERSION_PREVIEW, NOTE_FRONTMATTER_KEY } from "../constants";
import type { VersionHistoryEntry } from "../types";
import type { AppStore } from "../state/store";
import { AppStatus } from "../state/state"; // FIX: Changed to a value import to use the enum at runtime.

interface VersionPreviewViewDisplayState {
    version: VersionHistoryEntry;
    content: string;
    notePath: string;
    noteName: string;
    noteId: string;
}

export class VersionPreviewView extends ItemView {
    store: AppStore;
    app: App;
    private currentDisplayState: VersionPreviewViewDisplayState | null = null;
    private unsubscribeFromStore: (() => void) | null = null;

    private headerEl: HTMLElement | null = null;
    private contentPreviewEl: HTMLElement | null = null;
    private tabContentEl: HTMLElement | null = null;

    // New properties for markdown toggle
    private localRenderMarkdown: boolean = false;
    private currentContent: string = "";
    private currentNotePath: string = "";

    constructor(leaf: WorkspaceLeaf, store: AppStore, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "search"; 
    }

    getViewType(): string {
        return VIEW_TYPE_VERSION_PREVIEW;
    }

    getDisplayText(): string {
        if (this.currentDisplayState) {
            const { noteName, version } = this.currentDisplayState;
            const versionLabel = version.name || `V${version.versionNumber}`; 
            const shortNoteName = noteName.length > 20 ? noteName.substring(0, 17) + '...' : noteName;
            const shortVersionLabel = versionLabel.length > 30 ? versionLabel.substring(0, 27) + '...' : versionLabel;
            return `${shortNoteName} (${shortVersionLabel})`;
        }
        return "Version Preview"; 
    }

    async setState(state: any, options: any): Promise<void> {
        await super.setState(state, options);

        if (state && state.version && typeof state.content === 'string' && 
            typeof state.notePath === 'string' && typeof state.noteName === 'string' &&
            typeof state.noteId === 'string') {
            
            const newState = state as VersionPreviewViewDisplayState;
            if (!this.currentDisplayState || 
                this.currentDisplayState.noteId !== newState.noteId || 
                this.currentDisplayState.version.id !== newState.version.id) {
                this.currentDisplayState = newState;
                this.handleSubscription(); 
            } else {
                this.currentDisplayState.content = newState.content;
                this.currentDisplayState.version.name = newState.version.name;
            }

            if (this.tabContentEl) { 
                this.render(); 
            }
            this.updateTabTitle(); 
        } else {
            this.currentDisplayState = null;
            if (this.tabContentEl) {
                this.render(); 
            }
            this.clearSubscription();
        }
    }

    private updateVersionDisplayWithStatus(statusMessage: string): void {
        if (!this.currentDisplayState) return;
        const v = this.currentDisplayState.version;
        const baseNamePart = (v.name || `V${v.versionNumber}`).replace(/^\(Stale:.*?\)\s*/, '');
        this.currentDisplayState.version.name = `(Stale: ${statusMessage}) ${baseNamePart}`;
    }

    private clearSubscription() {
        if (this.unsubscribeFromStore) {
            this.unsubscribeFromStore();
            this.unsubscribeFromStore = null;
        }
    }

    private handleSubscription() {
        this.clearSubscription();

        if (!this.currentDisplayState) return;
            
        const previewingNoteId = this.currentDisplayState.noteId;
        const previewingVersionId = this.currentDisplayState.version.id;
        const previewingNotePath = this.currentDisplayState.notePath;
        
        this.unsubscribeFromStore = this.store.subscribe(async () => {
            if (!this.leaf.parent || !this.currentDisplayState || 
                this.currentDisplayState.noteId !== previewingNoteId || 
                this.currentDisplayState.version.id !== previewingVersionId) {
                this.clearSubscription();
                return;
            }

            const appState = this.store.getState();
            let isStale = false;
            let staleReason = "";

            const liveFile = this.app.vault.getAbstractFileByPath(previewingNotePath);
            if (!(liveFile instanceof TFile)) {
                isStale = true;
                staleReason = "Original Note Deleted/Moved";
            } else {
                const fileCache = this.app.metadataCache.getFileCache(liveFile);
                const idFromFrontmatter = fileCache?.frontmatter?.[NOTE_FRONTMATTER_KEY] ?? null;
                if (idFromFrontmatter !== previewingNoteId) {
                    isStale = true;
                    staleReason = "History Dissociated from File";
                } else if (appState.status === AppStatus.READY && appState.noteId === previewingNoteId) {
                    const versionExistsInCurrentHistory = appState.history.some(v => v.id === previewingVersionId);
                    if (!versionExistsInCurrentHistory) {
                        isStale = true;
                        staleReason = "Version Deleted from Active History";
                    }
                }
            }

            if (isStale) {
                this.currentDisplayState.content = `This preview is potentially stale. Reason: ${staleReason}.\n\nOriginal path: ${previewingNotePath}\nOriginal ID: ${previewingNoteId.substring(0,8)}...\nVersion ID: ${previewingVersionId.substring(0,8)}...`;
                this.updateVersionDisplayWithStatus(staleReason);
                this.render();
                this.updateTabTitle();
                this.clearSubscription();
            }
        });
    }

    private updateTabTitle() {
        // FIX: 'requestUpdateLayout' does not exist on Workspace.
        // 'trigger("layout-change")' is the correct way to ask Obsidian to
        // re-evaluate view titles.
        this.app.workspace.trigger("layout-change");
    }

    async onOpen() {
        this.containerEl.addClass("version-preview-view"); 
        this.tabContentEl = this.contentEl.createDiv("v-tab-view-content");
        
        if (this.currentDisplayState) {
            this.render(); 
            this.handleSubscription(); 
        } else {
            this.render();
        }
    }

    async onClose() {
        this.clearSubscription();
        this.contentEl.empty(); 
        this.currentDisplayState = null;
        this.headerEl = null;
        this.contentPreviewEl = null;
        this.tabContentEl = null;
    }

    private render() {
        if (!this.tabContentEl) return; 
        this.tabContentEl.empty(); 

        if (!this.currentDisplayState) {
            this.tabContentEl.setText("No version data to display. Open a version preview from the Version Control panel.");
            return;
        }

        const { version, content, notePath, noteName } = this.currentDisplayState;
        this.currentContent = content;
        this.currentNotePath = notePath;
        const settings = this.store.getState().settings;

        this.headerEl = this.tabContentEl.createDiv("v-panel-header"); 
        
        const titleRow = this.headerEl.createDiv({ cls: 'v-panel-title-row' });
        const versionDisplayLabel = version.name || `Version ${version.versionNumber}`;
        const titleEl = titleRow.createEl("h3", { text: versionDisplayLabel });
        titleEl.setAttribute("title", `Timestamp: ${moment(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`);
        
        // Add markdown toggle button
        if (!settings.renderMarkdownInPreview) {
            this.localRenderMarkdown = false; // Reset
            const toggleBtn = titleRow.createEl("button", {
                cls: "v-action-btn",
                attr: { "aria-label": "Toggle Markdown Rendering", "title": "Toggle Markdown Rendering" }
            });
            setIcon(toggleBtn, "book-open");
            toggleBtn.addEventListener("click", () => {
                this.localRenderMarkdown = !this.localRenderMarkdown;
                setIcon(toggleBtn, this.localRenderMarkdown ? "code" : "book-open");
                this.renderContentPreview();
            });
        }
        
        this.headerEl.createDiv({
            text: `Preview of a version from note: "${noteName}"`,
            cls: "v-meta-label" 
        });
        this.headerEl.createDiv({
            text: `Original path: ${notePath}`,
            cls: "v-meta-label"
        });

        this.contentPreviewEl = this.tabContentEl.createDiv({ cls: "v-version-content-preview" });
        this.renderContentPreview();
    }

    private renderContentPreview() {
        if (!this.contentPreviewEl) return;
        this.contentPreviewEl.empty();

        const settings = this.store.getState().settings;
        const shouldRenderMarkdown = settings.renderMarkdownInPreview || this.localRenderMarkdown;

        try {
            if (this.currentContent.startsWith("This preview is potentially stale.")) {
                this.contentPreviewEl.addClass('is-plaintext'); 
                this.contentPreviewEl.setText(this.currentContent);
            } else if (shouldRenderMarkdown) {
                this.contentPreviewEl.removeClass('is-plaintext');
                MarkdownRenderer.render(this.app, this.currentContent, this.contentPreviewEl, this.currentNotePath, this as Component);
            } else {
                this.contentPreviewEl.addClass('is-plaintext'); 
                this.contentPreviewEl.setText(this.currentContent);
            }
        } catch (error) {
            console.error("Version Control: Failed to render Markdown preview in dedicated tab.", error);
            if (this.contentPreviewEl) { 
                this.contentPreviewEl.empty(); 
                this.contentPreviewEl.addClass('is-plaintext');
                this.contentPreviewEl.setText(this.currentContent);
                this.contentPreviewEl.createEl('p', { text: 'Failed to render Markdown. Displaying as plain text.', cls: 'text-error' });
            }
        }
    }
}
