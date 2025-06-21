import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";
import { actions } from "../../state/actions";
import { BasePanelComponent } from "./BasePanelComponent";

export class ConfirmationPanelComponent extends BasePanelComponent {
    constructor(parent: HTMLElement, plugin: VersionControlPlugin) {
        super(parent, plugin, ["v-inline-panel", "v-confirmation-panel"]);
    }

    render(state: AppState) {
        this.container.empty();
        const { title, message, onConfirmAction } = state.ui.confirmation;

        this.container.createEl("h3", { text: title });
        this.container.createEl("p", { text: message });

        const buttons = this.container.createDiv("modal-buttons");
        const confirmBtn = buttons.createEl("button", { text: "Confirm", cls: "mod-warning" });
        confirmBtn.addEventListener("click", () => {
            if (onConfirmAction) {
                // Dispatch the thunk or action that was packaged with the confirmation request
                this.plugin.store.dispatch(onConfirmAction);
            }
        });
        
        const cancelBtn = buttons.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.plugin.store.dispatch(actions.hideConfirmation()));
    }
}