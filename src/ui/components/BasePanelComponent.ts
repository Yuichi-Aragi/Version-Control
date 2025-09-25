import { Component } from "obsidian";
import type { AppStore } from "../../state/store";
import { actions } from "../../state/appSlice";

/**
 * An abstract base class for UI panel components that typically overlay or integrate
 * closely with the main view area and can be shown or hidden.
 * It extends Component to provide a lifecycle for its children.
 */
export abstract class BasePanelComponent extends Component {
    protected container: HTMLElement;
    protected store: AppStore;

    constructor(parent: HTMLElement, store: AppStore, cssClasses: string[]) {
        super();
        this.store = store; // FIX: Initialize the store property.
        this.container = parent.createDiv({ cls: cssClasses });
        // this.container is hidden by default via CSS (.v-panel-container { display: none; })

        // Add a click handler to the background overlay to close modal-like panels.
        this.registerDomEvent(this.container, 'click', (event) => {
            // This logic closes the panel if the user clicks on the semi-transparent
            // background (the container itself) but not on any of its content.
            if (event.target === this.container && this.container.classList.contains('is-modal-like')) {
                this.store.dispatch(actions.closePanel());
            }
        });
    }

    /**
     * Main render function to be implemented by subclasses.
     * @param panelSpecificState Data relevant to this panel.
     * @param args Additional arguments.
     */
    abstract render(panelSpecificState: any, ...args: any[]): void;

    protected show(): void {
        this.container.classList.add('is-active');
    }

    protected hide(): void {
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
        return this.container.classList.contains('is-active');
    }

    public getContainer(): HTMLElement {
        return this.container;
    }

    override onunload() {
        // This will be called automatically when the parent component unloads.
        // It ensures the DOM element is removed from the parent.
        this.container.remove();
    }
}
