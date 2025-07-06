import { setIcon, HTMLElement as ObsidianHTMLElement } from "obsidian";

/**
 * Renders a single skeleton placeholder entry for the loading state.
 * @param parent The parent element to append the skeleton entry to.
 * @param isListView True if the skeleton should be for the compact list view.
 */
export function renderSkeletonEntry(parent: ObsidianHTMLElement, isListView: boolean): void {
    const entryEl = parent.createDiv("v-history-entry is-skeleton");
    entryEl.toggleClass('is-list-view', isListView);

    if (isListView) {
        // --- List View Skeleton ---
        const header = entryEl.createDiv("v-entry-header");
        header.createDiv({ cls: "v-version-id v-skeleton-item" });
        
        const mainInfo = header.createDiv('v-entry-main-info');
        mainInfo.createDiv({ cls: "v-version-name v-skeleton-item" });

        header.createDiv({ cls: "v-version-timestamp v-skeleton-item" });
    } else {
        // --- Card View Skeleton ---
        const header = entryEl.createDiv("v-entry-header");
        header.createDiv({ cls: "v-version-id v-skeleton-item" });
        header.createDiv({ cls: "v-version-name v-skeleton-item" });
        header.createDiv({ cls: "v-version-timestamp v-skeleton-item" });

        entryEl.createDiv({ cls: "v-version-content v-skeleton-item" });
    }
}

/**
 * Renders an empty state message (e.g., "No versions found") inside the list container.
 * @param listEl The list element to render the empty state into.
 * @param iconName The name of the icon to display.
 * @param title The main message title.
 * @param subtitle An optional secondary message.
 */
export function renderEmptyState(
    listEl: ObsidianHTMLElement, 
    iconName: string, 
    title: string, 
    subtitle?: string
): void {
    listEl.empty(); 

    const emptyStateContainer = listEl.createDiv({ cls: "v-empty-state" });
    const iconDiv = emptyStateContainer.createDiv({ cls: "v-empty-state-icon" });
    setIcon(iconDiv, iconName);
    emptyStateContainer.createEl("p", { cls: "v-empty-state-title", text: title });
    if (subtitle) {
        emptyStateContainer.createEl("p", { cls: "v-empty-state-subtitle v-meta-label", text: subtitle });
    }
}
