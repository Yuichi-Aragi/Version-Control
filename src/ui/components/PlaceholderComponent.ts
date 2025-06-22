import { setIcon } from "obsidian";

export class PlaceholderComponent {
    private container: HTMLElement;

    constructor(parent: HTMLElement) {
        this.container = parent.createDiv({ cls: "v-placeholder" });
    }

    render() {
        this.container.empty();
        const iconDiv = this.container.createDiv({ cls: "v-placeholder-icon" });
        setIcon(iconDiv, "file-text");
        this.container.createEl("p", { text: "Open a note to see its version history." });
        this.container.createEl("p", { 
            text: "Save a version to start tracking changes.",
            cls: "v-meta-label"
        });
    }

    /**
     * Toggles the visibility of the component by adding or removing the 'is-active' class.
     * @param show True to show, false to hide.
     */
    toggle(show: boolean) {
        this.container.classList.toggle('is-active', show);
    }

    /**
     * Removes the component's container from the DOM. Called by the parent view on close.
     */
    public destroy(): void {
        this.container.remove();
    }
}