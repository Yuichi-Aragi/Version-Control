import { setIcon } from "obsidian";

export class PlaceholderComponent {
    private container: HTMLElement;

    constructor(parent: HTMLElement) {
        this.container = parent.createDiv({ cls: "v-placeholder", attr: { style: "display: none;" } });
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

    show() {
        this.container.style.display = 'flex';
    }

    hide() {
        this.container.style.display = 'none';
    }

    /**
     * Toggles the visibility of the component.
     * @param show True to show, false to hide.
     */
    toggle(show: boolean) {
        this.container.style.display = show ? 'flex' : 'none';
    }
}