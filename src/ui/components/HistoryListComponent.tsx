import { setIcon, Component } from "obsidian";
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppStore } from "../../state/store";
import { AppStatus } from "../../state/state";
import type { AppState } from "../../state/state";
import type { VersionControlSettings } from "../../types";
import { getFilteredAndSortedHistory } from "./history/HistoryProcessor";
import { HistoryEntryRenderer } from "./history/HistoryEntryRenderer";
import { VirtualizedHistoryListComponent } from "./history/react/VirtualizedHistoryListComponent";

const TIMESTAMP_UPDATE_INTERVAL = 5000; // 5 seconds

// --- React Components defined within this file for cohesion ---

/**
 * Renders a single skeleton placeholder entry for the loading state.
 */
const SkeletonEntry: React.FC<{ isListView: boolean }> = ({ isListView }) => (
    <div className={`v-history-entry is-skeleton ${isListView ? 'is-list-view' : ''}`}>
        {isListView ? (
            <div className="v-entry-header">
                <div className="v-version-id v-skeleton-item" />
                <div className="v-entry-main-info">
                    <div className="v-version-name v-skeleton-item" />
                </div>
                <div className="v-version-timestamp v-skeleton-item" />
            </div>
        ) : (
            <>
                <div className="v-entry-header">
                    <div className="v-version-id v-skeleton-item" />
                    <div className="v-version-name v-skeleton-item" />
                    <div className="v-version-timestamp v-skeleton-item" />
                </div>
                <div className="v-version-content v-skeleton-item" />
            </>
        )}
    </div>
);
SkeletonEntry.displayName = 'SkeletonEntry';


/**
 * Renders a list of skeleton entries.
 */
const LoadingSkeletons: React.FC<{ settings: VersionControlSettings }> = ({ settings }) => (
    <div className={`v-history-list ${settings.isListView ? 'is-list-view' : ''}`}>
        {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonEntry key={i} isListView={settings.isListView} />
        ))}
    </div>
);
LoadingSkeletons.displayName = 'LoadingSkeletons';


/**
 * Renders an empty state message (e.g., "No versions found").
 */
const EmptyState: React.FC<{ icon: string; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
    <div className="v-empty-state">
        <div className="v-empty-state-icon" ref={el => { if (el) setIcon(el, icon); }} />
        <p className="v-empty-state-title">{title}</p>
        {subtitle && <p className="v-empty-state-subtitle v-meta-label">{subtitle}</p>}
    </div>
);
EmptyState.displayName = 'EmptyState';


/**
 * The main React root component that decides what to render in the history list area.
 */
const HistoryListRoot: React.FC<{ state: AppState; entryRenderer: HistoryEntryRenderer }> = ({ state, entryRenderer }) => {
    const processedHistory = getFilteredAndSortedHistory(state);

    if (state.history.length === 0) {
        return <EmptyState icon="inbox" title="No versions saved yet." subtitle="Click the 'Save new version' button to start tracking history for this note." />;
    }

    if (processedHistory.length === 0 && state.searchQuery.trim()) {
        return <EmptyState icon="search-x" title="No matching versions found." subtitle="Try a different search query or change sort options." />;
    }

    return (
        <VirtualizedHistoryListComponent
            key={state.settings.isListView ? 'list' : 'card'}
            items={processedHistory}
            state={state}
            entryRenderer={entryRenderer}
        />
    );
};
HistoryListRoot.displayName = 'HistoryListRoot';


// --- Obsidian Component Class ---

export class HistoryListComponent extends Component {
    private container: HTMLElement;
    private headerEl: HTMLElement | null = null;
    private listViewport: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;
    private entryRenderer: HistoryEntryRenderer;
    
    private reactRoot!: Root; // Definite assignment in constructor
    private timestampUpdateInterval: number | null = null;
    private lastState: AppState | null = null;

    constructor(parent: HTMLElement, store: AppStore) {
        super();
        this.container = parent.createDiv("v-history-list-container");
        this.entryRenderer = new HistoryEntryRenderer(store);
        this.buildSkeletonDOM();
        
        if (this.listViewport) {
            this.reactRoot = createRoot(this.listViewport);
        }
        
        this.container.hide();
    }

    render(state: AppState): void {
        this.lastState = state;

        if (state.status !== AppStatus.READY) {
            this.container.hide();
            this.stopTimestampUpdates();
            return;
        }

        this.container.classList.toggle('is-panel-active', state.panel !== null);
        this.listViewport?.classList.toggle('is-list-view', state.settings.isListView);

        if (this.reactRoot) {
            this.reactRoot.render(
                <React.StrictMode>
                    <HistoryListRoot state={state} entryRenderer={this.entryRenderer} />
                </React.StrictMode>
            );
        }

        const processedHistory = getFilteredAndSortedHistory(state);
        this.updateCountDisplay(processedHistory.length, state.history.length);
        this.container.show();
        this.startTimestampUpdates();
    }

    renderAsLoading(settings: VersionControlSettings): void {
        this.lastState = null;
        this.stopTimestampUpdates();
        
        if (!this.listViewport) return;

        this.updateCountDisplay("Loading...");
        this.listViewport.classList.toggle('is-list-view', settings.isListView);
        
        if (this.reactRoot) {
            this.reactRoot.render(
                <React.StrictMode>
                    <LoadingSkeletons settings={settings} />
                </React.StrictMode>
            );
        }
        
        this.container.show();
    }

    private buildSkeletonDOM(): void {
        this.headerEl = this.container.createDiv("v-history-header");
        setIcon(this.headerEl, "history");
        this.headerEl.createSpan({ text: " Version history" });
        this.countEl = this.headerEl.createSpan("v-history-count");
        this.listViewport = this.container.createDiv("v-history-list");
    }

    private updateCountDisplay(shown: number, total: number): void;
    private updateCountDisplay(message: string): void;
    private updateCountDisplay(shownOrMessage: number | string, total?: number): void {
        if (this.countEl) {
            if (typeof shownOrMessage === 'string') {
                this.countEl.setText(shownOrMessage);
            } else if (total !== undefined && shownOrMessage !== total) {
                this.countEl.setText(`${shownOrMessage} of ${total} versions`);
            } else {
                this.countEl.setText(`${shownOrMessage} ${shownOrMessage === 1 ? 'version' : 'versions'}`);
            }
        }
    }

    private startTimestampUpdates(): void {
        if (this.timestampUpdateInterval) return;
        this.timestampUpdateInterval = window.setInterval(() => {
            if (this.lastState && this.reactRoot && this.lastState.settings.useRelativeTimestamps) {
                // Re-rendering with the same state is enough to trigger timestamp updates
                // because `moment().fromNow()` will produce a new string.
                // React will efficiently update only the changed text nodes.
                this.reactRoot.render(
                    <React.StrictMode>
                        <HistoryListRoot state={this.lastState} entryRenderer={this.entryRenderer} />
                    </React.StrictMode>
                );
            }
        }, TIMESTAMP_UPDATE_INTERVAL);
    }

    private stopTimestampUpdates(): void {
        if (this.timestampUpdateInterval) {
            window.clearInterval(this.timestampUpdateInterval);
            this.timestampUpdateInterval = null;
        }
    }

    public getContainer(): HTMLElement {
        return this.container;
    }

    override onunload(): void {
        this.stopTimestampUpdates();
        // Unmount the React root when the component is unloaded
        if (this.reactRoot) {
            this.reactRoot.unmount();
        }
        this.container.remove();
    }
}
