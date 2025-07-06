import { Store } from "../../state/store";
import { ConfirmationPanel as ConfirmationPanelState, AppStatus } from "../../state/state";
import { actions } from "../../state/actions";
import { BasePanelComponent } from "./BasePanelComponent";

export class ConfirmationPanelComponent extends BasePanelComponent {
    private innerPanel: HTMLElement;

    constructor(parent: HTMLElement, store: Store) {
        super(parent, store, ["v-panel-container"]); 
        this.innerPanel = this.container.createDiv({ cls: "v-inline-panel v-confirmation-panel" });
    }

    render(panelState: ConfirmationPanelState | null) {
        this.toggle(!!panelState);
        
        if (!panelState) {
            if (this.innerPanel.hasChildNodes()) {
                this.innerPanel.empty();
            }
            return;
        }
        
        // FIX: The insufficient render guard has been removed. The panel will now always
        // re-render when a new confirmation is requested, ensuring the message and action are correct.
        this.innerPanel.empty();
        this.innerPanel.dataset.confirmationTitle = panelState.title;

        this.innerPanel.createEl("h3", { text: panelState.title });
        this.innerPanel.createEl("p", { text: panelState.message });

        const buttonsContainer = this.innerPanel.createDiv("modal-buttons");

        const confirmBtn = buttonsContainer.createEl("button", { text: "Confirm", cls: "mod-warning" });
        confirmBtn.setAttribute("aria-label", `Confirm: ${panelState.title}`);
        confirmBtn.addEventListener("click", () => {
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
        cancelBtn.addEventListener("click", () => {
            this.store.dispatch(actions.closePanel());
        });

        // Focus the confirm button for better accessibility.
        confirmBtn.focus();
    }
}
