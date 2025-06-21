import { setIcon } from "obsidian";
import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";
import { actions } from "../../state/actions";
import { thunks } from "../../state/thunks";

export class ActionBarComponent {
    private container: HTMLElement;
    private nameInputContainer: HTMLElement;
    private plugin: VersionControlPlugin;

    constructor(parent: HTMLElement, plugin: VersionControlPlugin) {
        this.container = parent.createDiv("v-actions-container");
        this.plugin = plugin;
    }

    render(state: AppState) {
        this.container.empty();

        const topActions = this.container.createDiv("v-top-actions");
        
        const saveBtn = topActions.createEl("button", { text: "Save New Version", cls: "v-save-button" });
        saveBtn.addEventListener("click", () => this.handleSaveVersionClick());

        const settingsBtn = topActions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Toggle Settings" } });
        setIcon(settingsBtn, "settings-2");
        settingsBtn.addEventListener("click", () => this.plugin.store.dispatch(actions.toggleSettingsPanel()));

        this.nameInputContainer = this.container.createDiv("v-name-input-container");
        
        this.nameInputContainer.classList.toggle('is-open', state.ui.isNameInputVisible);
        if (state.ui.isNameInputVisible) {
            this.renderNameInput();
        }
    }

    private handleSaveVersionClick() {
        const { settings, ui } = this.plugin.store.getState();
        if (settings.enableVersionNaming) {
            // Toggle the input visibility by dispatching an action
            this.plugin.store.dispatch(actions.toggleNameInput(!ui.isNameInputVisible));
        } else {
            // Directly save if naming is disabled
            this.plugin.store.dispatch(thunks.saveNewVersion());
        }
    }

    private renderNameInput() {
        this.nameInputContainer.empty();
        const input = this.nameInputContainer.createEl('input', { type: 'text', placeholder: 'Optional version name...' });
        requestAnimationFrame(() => input.focus());

        const buttonGroup = this.nameInputContainer.createDiv('v-button-group');
        const confirmBtn = buttonGroup.createEl('button', { cls: 'mod-cta', text: 'Save' });
        const cancelBtn = buttonGroup.createEl('button', { text: 'Cancel' });

        const cleanup = () => this.plugin.store.dispatch(actions.toggleNameInput(false));

        const handleSave = () => {
            this.plugin.store.dispatch(thunks.saveNewVersion(input.value.trim()));
            cleanup();
        };

        confirmBtn.addEventListener("click", handleSave);
        cancelBtn.addEventListener("click", cleanup);
        input.addEventListener("keydown", (e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') cleanup();
        });
    }
}