import { ItemView, WorkspaceLeaf, TFile, App } from "obsidian";
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';
import { VIEW_TYPE_VERSION_PREVIEW } from "../constants";
import type { VersionHistoryEntry } from "../types";
import type { AppStore } from "../state/store";
import { AppStatus } from "../state/state";
import { VersionPreviewRoot } from "./components/VersionPreviewRoot";

export interface VersionPreviewViewDisplayState {
    version: VersionHistoryEntry;
    content: string;
    notePath: string;
    noteName: string;
    noteId: string;
}

export class VersionPreviewView extends ItemView {
    store: AppStore;
    override app: App;
    private reactRoot: Root | null = null;
    private currentDisplayState: VersionPreviewViewDisplayState | null = null;
    private unsubscribeFromStore: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, store: AppStore, app: App) {
        super(leaf);
        this.store = store;
        this.app = app;
        this.icon = "search"; 
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_PREVIEW;
    }

    override getDisplayText(): string {
        if (this.currentDisplayState) {
            const { noteName, version } = this.currentDisplayState;
            const versionLabel = version.name || `V${version.versionNumber}`; 
            const shortNoteName = noteName.length > 20 ? noteName.substring(0, 17) + '...' : noteName;
            const shortVersionLabel = versionLabel.length > 30 ? versionLabel.substring(0, 27) + '...' : versionLabel;
            return `${shortNoteName} (${shortVersionLabel})`;
        }
        return "Version preview"; 
    }

    override async setState(state: any, options: any): Promise<void> {
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
                this.currentDisplayState.version.name = newState.version.name ?? '';
            }

            this.render();
            this.updateTabTitle(); 
        } else {
            this.currentDisplayState = null;
            this.render();
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
            const noteIdKey = appState.settings.noteIdFrontmatterKey;
            let isStale = false;
            let staleReason = "";

            const liveFile = this.app.vault.getAbstractFileByPath(previewingNotePath);
            if (!(liveFile instanceof TFile)) {
                isStale = true;
                staleReason = "Original note deleted/moved";
            } else {
                const fileCache = this.app.metadataCache.getFileCache(liveFile);
                const idFromFrontmatter = fileCache?.frontmatter?.[noteIdKey] ?? null;
                if (idFromFrontmatter !== previewingNoteId) {
                    isStale = true;
                    staleReason = "History dissociated from file";
                } else if (appState.status === AppStatus.READY && appState.noteId === previewingNoteId) {
                    const versionExistsInCurrentHistory = appState.history.some(v => v.id === previewingVersionId);
                    if (!versionExistsInCurrentHistory) {
                        isStale = true;
                        staleReason = "Version deleted from active history";
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
        this.app.workspace.trigger("layout-change");
    }

    override async onOpen() {
        this.containerEl.addClass("version-preview-view"); 
        this.reactRoot = createRoot(this.contentEl);
        this.render();
        if (this.currentDisplayState) {
            this.handleSubscription(); 
        }
    }

    override async onClose() {
        this.clearSubscription();
        this.reactRoot?.unmount();
        this.currentDisplayState = null;
    }

    private render() {
        if (!this.reactRoot) return;

        this.reactRoot.render(
            <StrictMode>
                <Provider store={this.store}>
                    <VersionPreviewRoot app={this.app} displayState={this.currentDisplayState} />
                </Provider>
            </StrictMode>
        );
    }
}
