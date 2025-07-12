import { setIcon, App, Component } from "obsidian";
import { AppStore } from "../../state/store";
import { AppError } from "../../types";
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

        const retryBtn = this.container.createEl("button", { text: "Retry Initialization", cls: "mod-cta" });
        retryBtn.setAttribute("aria-label", "Retry initializing the version control view");
        retryBtn.addEventListener("click", () => {
            this.store.dispatch(thunks.initializeView(this.app.workspace.activeLeaf));
        });
    }
    
    public getContainer(): HTMLElement {
        return this.container;
    }

    onunload() {
        this.container.remove();
    }
}
