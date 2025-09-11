import { setIcon, moment } from "obsidian";
import type { VersionHistoryEntry } from "../../../types";
import { formatFileSize } from "../../utils/dom";
import type { AppStore } from "../../../state/store";
import { AppStatus } from "../../../state/state";
import type { AppState } from "../../../state/state";
import { versionActions } from "../../VersionActions";
import type { VersionActionConfig } from "../../VersionActions";
import { thunks } from "../../../state/thunks/index";
import { actions } from "../../../state/appSlice";
import * as EventHandlers from "./HistoryEventHandlers";

export class HistoryEntryRenderer {
    constructor(private store: AppStore) {}

    /**
     * Creates a new DOM element for a version entry.
     * @param version The version data to render.
     * @param state The current application state.
     * @returns The newly created HTMLElement.
     */
    public render(version: VersionHistoryEntry, state: AppState): HTMLElement {
        const entryEl = document.createElement('div');
        // Perform a full, initial render of the element and its contents.
        this.update(entryEl, version, state, true);
        return entryEl;
    }

    /**
     * Updates an existing DOM element for a version entry.
     * It can perform a full re-render or a more surgical, performant update.
     * @param entryEl The element to update.
     * @param version The version data to render.
     * @param state The current application state.
     * @param isInitialRender If true, forces a full re-render of the element's contents.
     */
    public update(entryEl: HTMLElement, version: VersionHistoryEntry, state: AppState, isInitialRender: boolean = false): void {
        if (state.status !== AppStatus.READY) return;

        const { settings, namingVersionId, highlightedVersionId } = state;
        const isNamingThisVersion = version.id === namingVersionId;

        // --- Update classes (always safe to do) ---
        entryEl.className = 'v-history-entry'; // Reset classes
        entryEl.toggleClass('is-list-view', settings.isListView);
        entryEl.toggleClass('is-naming', isNamingThisVersion);
        entryEl.toggleClass('is-highlighted', version.id === highlightedVersionId);
        entryEl.dataset['versionId'] = version.id;

        // --- Decide if a full re-render is needed ---
        const isCurrentlyNaming = entryEl.querySelector('input.v-version-name-input') !== null;
        const needsFullReRender = isInitialRender || (isNamingThisVersion !== isCurrentlyNaming);

        if (needsFullReRender) {
            this.reRenderContents(entryEl, version, state);
            return;
        }

        // --- If we are in naming mode, do not touch the input to avoid focus loss ---
        if (isNamingThisVersion) {
            return;
        }

        // --- Otherwise, perform surgical updates for performance ---
        this.updateTimestamp(entryEl, version, state);
    }

    /**
     * Surgically updates only the timestamp portion of an entry.
     * This is the most common update and avoids disturbing other elements.
     */
    private updateTimestamp(entryEl: HTMLElement, version: VersionHistoryEntry, state: AppState): void {
        const timestampEl = entryEl.querySelector('.v-version-timestamp');
        if (timestampEl) {
            const timestampText = state.settings.useRelativeTimestamps
                ? moment(version.timestamp).fromNow()
                : moment(version.timestamp).format("YYYY-MM-DD HH:mm");
            if (timestampEl.textContent !== timestampText) {
                timestampEl.setText(timestampText);
            }
        }
    }

    /**
     * Performs a full, destructive re-render of the element's contents.
     * This is only called when the structure needs to change (e.g., entering/exiting naming mode).
     */
    private reRenderContents(entryEl: HTMLElement, version: VersionHistoryEntry, state: AppState): void {
        entryEl.empty();

        const { settings, namingVersionId, panel } = state;
        const isNamingThisVersion = version.id === namingVersionId;
        const isPanelOpen = panel !== null;

        entryEl.setAttribute('role', 'listitem');
        // FIX: Explicitly clear event handlers on the root element before re-attaching them.
        // This prevents stale handlers from persisting when the panel state changes.
        entryEl.onclick = null;
        entryEl.oncontextmenu = null;
        entryEl.onkeydown = null;
        entryEl.removeAttribute('tabindex');

        // --- Header ---
        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version.versionNumber}` });

        if (isNamingThisVersion) {
            this.renderNameInput(header, version);
        } else if (settings.isListView) {
            const mainInfoWrapper = header.createDiv('v-entry-main-info');
            if (version.name) {
                mainInfoWrapper.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
            } else {
                mainInfoWrapper.createDiv({ cls: "v-version-name is-empty" });
            }
        } else {
            if (version.name) {
                header.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
            }
        }
        
        const timestampEl = header.createSpan({ cls: "v-version-timestamp" });
        const timestampText = settings.useRelativeTimestamps
            ? moment(version.timestamp).fromNow()
            : moment(version.timestamp).format("YYYY-MM-DD HH:mm");
        timestampEl.setText(timestampText);
        timestampEl.setAttribute("title", moment(version.timestamp).format("LLLL")); 

        // --- Body / Listeners ---
        if (settings.isListView) {
            if (!isPanelOpen) {
                entryEl.onclick = (e) => EventHandlers.handleEntryClick(version, e, this.store);
                entryEl.oncontextmenu = (e) => EventHandlers.handleEntryContextMenu(version, e, this.store);
                entryEl.setAttribute('tabindex', '0');
                entryEl.onkeydown = (e) => EventHandlers.handleEntryKeyDown(version, e, this.store);
            }
        } else {
            if (!isPanelOpen) {
                entryEl.oncontextmenu = (e) => EventHandlers.handleEntryContextMenu(version, e, this.store);
            }
            
            const contentEl = entryEl.createDiv("v-version-content");
            contentEl.setText(`Size: ${formatFileSize(version.size)}`);
            
            const footer = entryEl.createDiv("v-entry-footer");
            this.createActionButtons(footer, version, isPanelOpen);
        }
    }

    public renderErrorEntry(parent: DocumentFragment | HTMLElement, version: VersionHistoryEntry | null): void {
        const entryEl = parent.createDiv("v-history-entry is-error");
        entryEl.setAttribute('role', 'listitem');
        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version?.versionNumber ?? '??'}` });
        header.createDiv({ cls: "v-version-name", text: "Error rendering this entry" });
        const iconSpan = header.createSpan({cls: "v-error-icon"});
        setIcon(iconSpan, "alert-circle");
        const contentEl = entryEl.createDiv("v-version-content");
        contentEl.setText("Issue displaying this version. Check console.");
    }

    private renderNameInput(parent: HTMLElement, version: VersionHistoryEntry): void {
        const initialValue = version.name || '';

        const input = parent.createEl('input', {
            type: 'text',
            cls: 'v-version-name-input',
            value: initialValue,
            attr: {
                placeholder: 'Version name...',
                'aria-label': 'Version name input'
            }
        });

        const saveDetails = () => {
            if (!input.isConnected) return;
            const rawValue = input.value.trim();
            if (rawValue !== (version.name || '')) {
                this.store.dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        input.onblur = () => {
            // Use a short timeout to allow other click events to process before
            // this blur handler potentially re-renders the UI and removes the clicked element.
            setTimeout(saveDetails, 150);
        };

        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur(); // Triggers the onblur handler to save
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // On escape, we don't save. Just stop editing immediately.
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        // Defer focus to ensure the element is fully in the DOM and ready.
        setTimeout(() => {
            if (input.isConnected) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }, 0);
    }

    private createActionButtons(container: HTMLElement, version: VersionHistoryEntry, isPanelOpen: boolean): void {
        const viewBtn = container.createEl("button", {
            cls: "v-action-btn",
            attr: { "aria-label": "Preview in panel", "title": "Preview in panel" }
        });
        setIcon(viewBtn, "eye");
        if (!isPanelOpen) {
            viewBtn.onclick = (e: MouseEvent) => {
                e.preventDefault(); // Prevent any default button action
                e.stopPropagation(); // Stop the click from propagating to the entry itself
                this.store.dispatch(thunks.viewVersionInPanel(version));
            };
        }

        versionActions.forEach((actionConfig: VersionActionConfig) => {
            const btn = container.createEl("button", { 
                cls: `v-action-btn ${actionConfig.isDanger ? 'danger' : ''}`, 
                attr: { "aria-label": actionConfig.tooltip, "title": actionConfig.tooltip } 
            });
            setIcon(btn, actionConfig.icon);
            if (!isPanelOpen) {
                btn.onclick = (e: MouseEvent) => {
                    e.preventDefault(); // Prevent any default button action
                    e.stopPropagation(); // Stop the click from propagating to the entry itself
                    actionConfig.actionHandler(version, this.store);
                };
            }
        });
    }
}
