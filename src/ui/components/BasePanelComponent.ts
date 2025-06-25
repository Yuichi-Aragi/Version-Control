import { Component } from "obsidian";
import { Store } from "../../state/store";

/**
 * An abstract base class for UI panel components that typically overlay or integrate
 * closely with the main view area and can be shown or hidden.
 * It extends Component to provide a lifecycle for its children.
 */
export abstract class BasePanelComponent extends Component {
    protected container: HTMLElement;
    protected store: Store;

    constructor(parent: HTMLElement, store: Store, cssClasses: string[]) {
        super();
        this.container = parent.createDiv({ cls: cssClasses });
        this.store = store;
        this.container.hide(); // Initially hidden
    }

    /**
     * Main render function to be implemented by subclasses.
     * @param panelSpecificState Data relevant to this panel.
     * @param args Additional arguments.
     */
    abstract render(panelSpecificState: any, ...args: any[]): void;

    protected show(): void {
        this.container.show();
        this.container.classList.add('is-active');
    }

    protected hide(): void {
        this.container.hide();
        this.container.classList.remove('is-active');
    }

    /**
     * Toggles visibility. Subclasses call this in their render method.
     * @param shouldShow True to show, false to hide.
     */
    protected toggle(shouldShow: boolean): void {
        if (shouldShow) {
            this.show();
        } else {
            this.hide();
        }
    }

    public get isVisible(): boolean {
        return this.container.style.display !== 'none' && this.container.classList.contains('is-active');
    }

    public getContainer(): HTMLElement {
        return this.container;
    }

    onunload() {
        // This will be called automatically when the parent component unloads.
        // It ensures the DOM element is removed from the parent.
        this.container.remove();
    }
}
