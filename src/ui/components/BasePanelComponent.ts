import VersionControlPlugin from "../../main";
import { AppState } from "../../state/state";

/**
 * An abstract base class for UI panel components that can be shown or hidden.
 * It encapsulates the common logic for visibility toggling.
 */
export abstract class BasePanelComponent {
    protected container: HTMLElement;
    protected plugin: VersionControlPlugin;

    constructor(parent: HTMLElement, plugin: VersionControlPlugin, cssClasses: string[]) {
        this.container = parent.createDiv({ cls: cssClasses });
        this.plugin = plugin;
    }

    /**
     * The main render function to be implemented by subclasses.
     * @param state The current application state.
     * @param args Additional arguments that might be needed for rendering.
     */
    abstract render(state: AppState, ...args: any[]): void;

    /**
     * Makes the panel visible.
     */
    show() {
        this.container.classList.add('is-active');
    }

    /**
     * Hides the panel.
     */
    hide() {
        this.container.classList.remove('is-active');
    }

    /**
     * Toggles the visibility of the panel.
     * @param show True to show, false to hide.
     */
    toggle(show: boolean) {
        if (show) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Checks if the panel is currently visible.
     */
    get isVisible(): boolean {
        return this.container.classList.contains('is-active');
    }
}