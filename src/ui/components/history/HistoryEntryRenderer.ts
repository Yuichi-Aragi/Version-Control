import { setIcon, moment } from "obsidian";
import { VersionHistoryEntry } from "../../../types";
import { formatFileSize } from "../../utils/dom";
import { AppStore } from "../../../state/store";
import { AppState, AppStatus } from "../../../state/state";
import { versionActions, VersionActionConfig } from "../../VersionActions";
import { thunks } from "../../../state/thunks/index";
import { actions } from "../../../state/appSlice";
import * as EventHandlers from "./HistoryEventHandlers";

export class HistoryEntryRenderer {
    constructor(private store: AppStore) {}

    public render(version: VersionHistoryEntry, state: AppState): HTMLElement {
        const entryEl = document.createElement('div');
        entryEl.className = 'v-history-entry';
        this.update(entryEl, version, state);
        return entryEl;
    }

    public update(entryEl: HTMLElement, version: VersionHistoryEntry, state: AppState): void {
        if (state.status !== AppStatus.READY) return;

        const { settings, namingVersionId, highlightedVersionId } = state;
        const isNamingThisVersion = version.id === namingVersionId;

        entryEl.className = 'v-history-entry'; // Reset classes
        entryEl.toggleClass('is-list-view', settings.isListView);
        entryEl.toggleClass('is-naming', isNamingThisVersion);
        entryEl.toggleClass('is-highlighted', version.id === highlightedVersionId);
        entryEl.setAttribute('role', 'listitem');
        entryEl.dataset.versionId = version.id;
        
        const signature = `${version.name || ''}|${isNamingThisVersion}|${settings.isListView}|${settings.useRelativeTimestamps}`;
        if (entryEl.dataset.signature === signature) {
            return; // No need to re-render DOM children if signature is the same
        }
        entryEl.dataset.signature = signature;
        
        entryEl.empty(); // Clear previous content before re-rendering

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
                // Add a placeholder for alignment if name is missing in list view
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
            entryEl.onclick = (e) => EventHandlers.handleEntryClick(version, e, this.store);
            entryEl.oncontextmenu = (e) => EventHandlers.handleEntryContextMenu(version, e, this.store);
            entryEl.setAttribute('tabindex', '0');
            entryEl.onkeydown = (e) => EventHandlers.handleEntryKeyDown(version, e, this.store);
        } else {
            entryEl.oncontextmenu = (e) => EventHandlers.handleEntryContextMenu(version, e, this.store);
            
            const contentEl = entryEl.createDiv("v-version-content");
            contentEl.setText(`Size: ${formatFileSize(version.size)}`);
            
            const footer = entryEl.createDiv("v-entry-footer");
            this.createActionButtons(footer, version);
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
            if (rawValue !== initialValue) {
                this.store.dispatch(thunks.updateVersionDetails(version.id, rawValue));
            } else {
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        input.onblur = () => {
            setTimeout(saveDetails, 100);
        };

        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveDetails();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.store.dispatch(actions.stopVersionEditing());
            }
        };

        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }

    private createActionButtons(container: HTMLElement, version: VersionHistoryEntry): void {
        const viewBtn = container.createEl("button", {
            cls: "v-action-btn",
            attr: { "aria-label": "Preview in Panel", "title": "Preview in Panel" }
        });
        setIcon(viewBtn, "eye");
        viewBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation(); 
            this.store.dispatch(thunks.viewVersionInPanel(version));
        };

        versionActions.forEach((actionConfig: VersionActionConfig) => {
            const btn = container.createEl("button", { 
                cls: `v-action-btn ${actionConfig.isDanger ? 'danger' : ''}`, 
                attr: { "aria-label": actionConfig.tooltip, "title": actionConfig.tooltip } 
            });
            setIcon(btn, actionConfig.icon);
            btn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                actionConfig.actionHandler(version, this.store);
            };
        });
    }
}
