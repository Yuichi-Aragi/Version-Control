import { setIcon, HTMLElement as ObsidianHTMLElement, Component } from "obsidian";

export class PlaceholderComponent extends Component {
    private container: ObsidianHTMLElement;
    private currentTitle: string | undefined;
    private currentIcon: string | undefined;


    constructor(parent: ObsidianHTMLElement) {
        super();
        this.container = parent.createDiv({ cls: "v-placeholder" });
        this.container.hide();
    }

    render(title?: string, iconName?: string) {
        const newTitle = title || "Open a Markdown note to see its version history.";
        const newIcon = iconName || "file-text";

        // Only re-render if content actually changes to prevent unnecessary DOM manipulation
        if (this.currentTitle === newTitle && this.currentIcon === newIcon && this.container.hasChildNodes()) {
            // this.container.show(); // Visibility is controlled by VersionControlView
            return;
        }
        
        this.currentTitle = newTitle;
        this.currentIcon = newIcon;
        this.container.empty();

        const iconDiv = this.container.createDiv({ cls: "v-placeholder-icon" });
        setIcon(iconDiv, newIcon);

        this.container.createEl("p", { 
            text: newTitle,
            cls: "v-placeholder-title"
        });

        if (!title) { // Show default subtitle only if no custom title is provided
            this.container.createEl("p", { 
                text: "If the note is already open, try focusing its editor pane. Save a version to begin tracking changes.",
                cls: "v-placeholder-subtitle v-meta-label"
            });
        }
        // this.container.show(); // Visibility is controlled by VersionControlView
    }

    public getContainer(): ObsidianHTMLElement {
        return this.container;
    }

    onunload() {
        this.container.remove();
    }
}
