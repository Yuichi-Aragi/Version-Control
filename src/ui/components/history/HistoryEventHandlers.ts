import { MouseEvent as ObsidianMouseEvent } from "obsidian";
import { Store } from "../../../state/store";
import { thunks } from "../../../state/thunks";
import { VersionHistoryEntry } from "../../../types";

/**
 * Handles a click event on a history entry, typically to preview it.
 * @param version The version entry that was clicked.
 * @param event The mouse event.
 * @param store The application store.
 */
export function handleEntryClick(version: VersionHistoryEntry, event: MouseEvent, store: Store): void {
    event.preventDefault();
    event.stopPropagation();
    // For list view, a direct click should perform the primary action: preview in panel.
    store.dispatch(thunks.viewVersionInPanel(version));
}

/**
 * Handles a context menu event on a history entry to show available actions.
 * @param version The version entry that was right-clicked.
 * @param event The mouse event.
 * @param store The application store.
 */
export function handleEntryContextMenu(version: VersionHistoryEntry, event: MouseEvent, store: Store): void {
    // Prevent context menu from showing on the name/tag input field
    if (event.target instanceof HTMLInputElement && event.target.classList.contains('v-version-name-input')) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    store.dispatch(thunks.showVersionContextMenu(version, event as unknown as ObsidianMouseEvent));
}

/**
 * Handles keyboard events for accessibility on a history entry.
 * @param version The version entry that received the event.
 * @param event The keyboard event.
 * @param store The application store.
 */
export function handleEntryKeyDown(version: VersionHistoryEntry, event: KeyboardEvent, store: Store): void {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        // On keyboard activation, open the full context menu for accessibility.
        let mouseEvent: ObsidianMouseEvent;
        if (event.target instanceof HTMLElement) { 
            const rect = event.target.getBoundingClientRect();
            mouseEvent = new MouseEvent("contextmenu", {
                bubbles: true, cancelable: true,
                clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            }) as unknown as ObsidianMouseEvent;
        } else {
            // Fallback if target is not an element
            mouseEvent = new MouseEvent("contextmenu") as unknown as ObsidianMouseEvent;
        }
        store.dispatch(thunks.showVersionContextMenu(version, mouseEvent));
    }
}
