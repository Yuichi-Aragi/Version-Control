import type { AppStore } from "../../state/store";
import type { ConfirmationPanel as ConfirmationPanelState } from "../../state/state";
import { AppStatus } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";

export class ConfirmationPanelComponent extends BasePanelComponent {
    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container", "is-modal-like"]);
    }

    render(panelState: ConfirmationPanelState | null) {
        this.toggle(!!panelState);
        this.container.empty(); // Ensure a clean slate on every render.
        
        if (!panelState) {
            return;
        }
        
        const innerPanel = this.container.createDiv({ cls: "v-inline-panel v-confirmation-panel" });
        innerPanel.dataset['confirmationTitle'] = panelState.title;

        innerPanel.createEl("h3", { text: panelState.title });
        innerPanel.createEl("p", { text: panelState.message });

        const buttonsContainer = innerPanel.createDiv("modal-buttons");

        const confirmBtn = buttonsContainer.createEl("button", { text: "Confirm", cls: "mod-warning" });
        confirmBtn.setAttribute("aria-label", `Confirm: ${panelState.title}`);
        this.registerDomEvent(confirmBtn, "click", () => {
            const currentState = this.store.getState();
            if (currentState.status === AppStatus.READY && !currentState.isProcessing) {
                this.store.dispatch(panelState.onConfirmAction);
            } else {
                // If the state is no longer ready, just close the panel.
                this.store.dispatch(actions.closePanel());
            }
        });
        
        const cancelBtn = buttonsContainer.createEl("button", { text: "Cancel" });
        cancelBtn.setAttribute("aria-label", "Cancel action");
        this.registerDomEvent(cancelBtn, "click", () => {
            this.store.dispatch(actions.closePanel());
        });

        // Focus the confirm button for better accessibility.
        setTimeout(() => confirmBtn.focus(), 50);
    }
}