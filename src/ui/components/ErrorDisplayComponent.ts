import { setIcon, App, Component } from "obsidian";
import type { AppStore } from "../../state/store";
import type { AppError } from "../../types";
import { thunks } from "../../state/thunks/index";

export class ErrorDisplayComponent extends Component {
    private container: HTMLElement;
    private store: AppStore;
    private app: App;

    constructor(parent: HTMLElement, store: AppStore, app: App) {
        super();
        this.container = parent.createDiv({ cls: "v-placeholder v-error-display" }); 
        this.store = store;
        this.app = app;
        this.container.hide();
    }

    render(error: AppError | null) {
        if (!error) {
            this.container.hide();
            return;
        }

        this.container.empty();
        this.container.show();

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
            // FIX: Replaced the deprecated `app.workspace.activeLeaf` with a call
            // to `initializeView()` without arguments. The thunk is designed to
            // safely find the active markdown view using the recommended API
            // (`getActiveViewOfType`) when no leaf is provided.
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
