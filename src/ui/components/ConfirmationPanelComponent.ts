import type { AppStore } from "../../state/store";
import type { ConfirmationPanel as ConfirmationPanelState } from "../../state/state";
import { AppStatus } from "../../state/state";
import { actions } from "../../state/appSlice";
import { BasePanelComponent } from "./BasePanelComponent";

export class ConfirmationPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;

    constructor(parent: HTMLElement, store: AppStore) {
        super(parent, store, ["v-panel-container"]); 
        this.innerPanel = this.container.createDiv({ cls: "v-inline-panel v-confirmation-panel" });
        this.container.classList.add('is-modal-like');
    }

    render(panelState: ConfirmationPanelState | null) {
        this.toggle(!!panelState);
        
        if (!panelState) {
            if (this.innerPanel.hasChildNodes()) {
                this.innerPanel.empty();
            }
            return;
        }
        
        this.innerPanel.empty();
        this.innerPanel.dataset['confirmationTitle'] = panelState.title;

        this.innerPanel.createEl("h3", { text: panelState.title });
        this.innerPanel.createEl("p", { text: panelState.message });

        const buttonsContainer = this.innerPanel.createDiv("modal-buttons");

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