import { App, TFolder, FuzzySuggestModal, moment, type FuzzyMatch } from "obsidian";
import type { DiffTarget, VersionHistoryEntry } from "../types";

/**
 * A base class for suggestion modals that standardizes the handling of
 * choosing an item versus cancelling the modal.
 */
abstract class BaseSuggestModal<T> extends FuzzySuggestModal<T> {
    private itemChosen: boolean = false;

    constructor(
        app: App,
        private onChooseCallback: (result: T) => void,
        private onCancelCallback?: () => void
    ) {
        super(app);
    }

    override onChooseItem(item: T, _evt: MouseEvent | KeyboardEvent): void {
        this.itemChosen = true;
        this.onChooseCallback(item);
    }

    override onClose(): void {
        super.onClose();
        if (!this.itemChosen && this.onCancelCallback) {
            this.onCancelCallback();
        }
    }
}

export class FolderSuggest extends BaseSuggestModal<TFolder> {
    constructor(app: App, onChoose: (result: TFolder) => void, onCancel?: () => void) {
        super(app, onChoose, onCancel);
        this.setPlaceholder("Select a folder for export or deviation...");
    }

    getItems(): TFolder[] {
        const folders = this.app.vault.getAllFolders();
        return folders;
    }

    getItemText(item: TFolder): string {
        return item.isRoot() ? "/" : item.path;
    }
}

export class VersionSuggest extends BaseSuggestModal<DiffTarget> {
    private targets: DiffTarget[];

    constructor(app: App, targets: DiffTarget[], onChoose: (result: DiffTarget) => void, onCancel?: () => void) {
        super(app, onChoose, onCancel);
        this.targets = targets;
        this.setPlaceholder("Select a version to compare against...");
    }

    getItems(): DiffTarget[] {
        return this.targets;
    }

    getItemText(target: DiffTarget): string {
        // Use a more robust type guard by checking for a property unique to VersionHistoryEntry.
        if ('versionNumber' in target) {
            const version = target as VersionHistoryEntry;
            const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;
            const timeLabel = moment(version.timestamp).format('YYYY-MM-DD HH:mm:ss');
            return `${versionLabel} (${timeLabel})`;
        } else {
            // It must be the CurrentNoteState type, where `name` is a required string.
            return target.name;
        }
    }

    override renderSuggestion(match: FuzzyMatch<DiffTarget>, el: HTMLElement): void {
        const target = match.item; // Extract the actual item from the match object
        el.addClass('mod-complex');
        const content = el.createDiv('suggestion-content');
        const title = content.createDiv('suggestion-title');
        const note = content.createDiv('suggestion-note');

        // The `in` operator provides a reliable way for TypeScript to discriminate the union.
        if ('versionNumber' in target) {
            const version = target as VersionHistoryEntry; // TypeScript now knows this is a VersionHistoryEntry
            const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;
            title.setText(versionLabel);
            note.setText(moment(version.timestamp).format('LLLL'));
        } else {
            // It must be the CurrentNoteState type
            title.setText(target.name);
            note.setText('The current, unsaved content of the note.');
        }
    }
}
