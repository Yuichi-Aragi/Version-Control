import { setIcon, moment, HTMLElement as ObsidianHTMLElement } from "obsidian";
import { VersionHistoryEntry } from "../../../types";
import { formatFileSize } from "../../utils/dom";
import { Store } from "../../../state/store";
import { ReadyState } from "../../../state/state";
import { versionActions, VersionActionConfig } from "../../VersionActions";
import { thunks } from "../../../state/thunks/index";
import { actions } from "../../../state/actions";
import * as EventHandlers from "./HistoryEventHandlers";

/**
 * Handles the rendering of a single version history entry into an HTMLElement.
 */
export class HistoryEntryRenderer {
    constructor(private store: Store) {}

    /**
     * Creates and appends an HTMLElement for a given version history entry to a parent.
     * @param parent The parent element or document fragment.
     * @param version The version data to render.
     * @param state The current ReadyState of the application.
     */
    public render(parent: DocumentFragment | ObsidianHTMLElement, version: VersionHistoryEntry, state: ReadyState): void {
        const { settings, namingVersionId, highlightedVersionId, expandedTagIds } = state;
        const isNamingThisVersion = version.id === namingVersionId;
        const isExpanded = expandedTagIds.includes(version.id);

        const entryEl = parent.createDiv("v-history-entry");
        entryEl.toggleClass('is-list-view', settings.isListView);
        entryEl.toggleClass('is-naming', isNamingThisVersion);
        entryEl.toggleClass('is-highlighted', version.id === highlightedVersionId);
        entryEl.toggleClass('is-tags-expanded', isExpanded);
        entryEl.setAttribute('role', 'listitem');
        entryEl.dataset.versionId = version.id;
        // A signature to quickly check if the element needs a full re-render.
        entryEl.dataset.signature = `${version.name || ''}|${(version.tags || []).join(',')}|${isNamingThisVersion}|${isExpanded}`;

        // --- Header ---
        const header = entryEl.createDiv("v-entry-header");
        header.createSpan({ cls: "v-version-id", text: `V${version.versionNumber}` });

        if (isNamingThisVersion) {
            this.renderNameInput(header, version);
        } else if (settings.isListView) {
            // List View Header
            const mainInfoWrapper = header.createDiv('v-entry-main-info');
            if (version.name) {
                mainInfoWrapper.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
            }
            if (version.tags && version.tags.length > 0) {
                this.renderTags(mainInfoWrapper, version, true);
            }
        } else {
            // Card View Header
            if (version.name) {
                header.createDiv({ cls: "v-version-name", text: version.name, attr: { "title": version.name } });
            }
        }
        
        const timestampEl = header.createSpan({ cls: "v-version-timestamp" });
        timestampEl.setText(moment(version.timestamp).fromNow(!settings.showTimestamps));
        timestampEl.setAttribute("title", moment(version.timestamp).format("LLLL")); 

        // --- Body / Listeners ---
        if (settings.isListView) {
            // List View Body (event listeners)
            entryEl.addEventListener("click", (e) => EventHandlers.handleEntryClick(version, e, this.store));
            entryEl.addEventListener("contextmenu", (e) => EventHandlers.handleEntryContextMenu(version, e, this.store));
            entryEl.setAttribute('tabindex', '0');
            entryEl.addEventListener('keydown', (e) => EventHandlers.handleEntryKeyDown(version, e, this.store));
        } else {
            // Card View Body
            entryEl.addEventListener("contextmenu", (e) => EventHandlers.handleEntryContextMenu(version, e, this.store));
            
            const contentEl = entryEl.createDiv("v-version-content");
            contentEl.setText(`Size: ${formatFileSize(version.size)}`);
            
            if (version.tags && version.tags.length > 0) {
                this.renderTags(entryEl, version, false);
            }
            
            const footer = entryEl.createDiv("v-entry-footer");
            this.createActionButtons(footer, version);
        }
    }

    /**
     * Renders an entry that indicates an error occurred during rendering.
     * @param parent The parent element or document fragment.
     * @param version The version data that caused the error, can be null.
     */
    public renderErrorEntry(parent: DocumentFragment | ObsidianHTMLElement, version: VersionHistoryEntry | null): void {
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

    private renderTags(parent: HTMLElement, version: VersionHistoryEntry, isListView: boolean): void {
        const tagsContainer = parent.createDiv('v-version-tags');
        tagsContainer.toggleClass('is-list-view', isListView);

        tagsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            this.store.dispatch(actions.toggleTagExpansion(version.id));
        });

        (version.tags || []).forEach(tag => {
            const tagEl = tagsContainer.createSpan('v-version-tag');
            tagEl.setText(`#${tag}`);
            tagEl.setAttribute('title', `#${tag}`);
        });
    }

    private renderNameInput(parent: HTMLElement, version: VersionHistoryEntry): void {
        const initialValue = [
            version.name || '',
            ...(version.tags || []).map(t => `#${t}`)
        ].join(' ').trim();

        const input = parent.createEl('input', {
            type: 'text',
            cls: 'v-version-name-input',
            value: initialValue,
            attr: {
                placeholder: 'Name and #tags...',
                'aria-label': 'Version name and tags input'
            }
        });

        const saveDetails = () => {
            if (!input.isConnected) return;
            const rawValue = input.value.trim();
            if (rawValue !== initialValue) {
                this.store.dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        input.addEventListener('blur', () => {
            setTimeout(saveDetails, 100);
        });

        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveDetails();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.store.dispatch(actions.stopVersionEditing());
            }
        });

        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }

    private createActionButtons(container: ObsidianHTMLElement, version: VersionHistoryEntry): void {
        const viewBtn = container.createEl("button", {
            cls: "v-action-btn",
            attr: { "aria-label": "Preview in Panel", "title": "Preview in Panel" }
        });
        setIcon(viewBtn, "eye");
        viewBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation(); 
            this.store.dispatch(thunks.viewVersionInPanel(version));
        });

        versionActions.forEach((actionConfig: VersionActionConfig) => {
            const btn = container.createEl("button", { 
                cls: `v-action-btn ${actionConfig.isDanger ? 'danger' : ''}`, 
                attr: { "aria-label": actionConfig.tooltip, "title": actionConfig.tooltip } 
            });
            setIcon(btn, actionConfig.icon);
            btn.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                actionConfig.actionHandler(version, this.store);
            });
        });
    }
}
