import { setIcon, Component } from "obsidian";
import type { AppStore } from "../../state/store";
import type { AppError } from "../../types";
import { thunks } from "../../state/thunks/index";

export class ErrorDisplayComponent extends Component {
    private container: HTMLElement;
    private store: AppStore;

    constructor(parent: HTMLElement, store: AppStore) {
        super();
        this.container = parent.createDiv({ cls: "v-placeholder v-error-display" }); 
        this.store = store;
        // Visibility is controlled by VersionControlView via the .is-hidden class
    }

    render(error: AppError | null) {
        if (!error) {
            // The parent view will hide this component if there is no error.
            return;
        }

        this.container.empty();

        const iconDiv = this.container.createDiv({ cls: "v-placeholder-icon" });
        setIcon(iconDiv, "alert-triangle");

        this.container.createEl("h3", { text: error.title });
        this.container.createEl("p", { text: error.message, cls: "v-meta-label" });

        if (error.details) {
            const detailsPre = this.container.createEl("pre", { cls: "v-error-details" });
            detailsPre.setText(error.details);
        }

        const retryBtn = this.container.createEl("button", { text: "Retry initialization", cls: "mod-cta" });
        retryBtn.setAttribute("aria-label", "Retry initializing the version control view");
        retryBtn.addEventListener("click", () => {
            this.store.dispatch(thunks.initializeView());
        });
    }
    
    public getContainer(): HTMLElement {
        return this.container;
    }

    override onunload() {
        this.container.remove();
    }
}