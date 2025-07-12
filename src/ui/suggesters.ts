import { App, TFolder, FuzzySuggestModal, moment, FuzzyMatch } from "obsidian";
import type { DiffTarget } from "../types";

export class FolderSuggest extends FuzzySuggestModal<TFolder> {
    onChoose: (result: TFolder) => void;
    onCancel?: () => void;
    private itemChosen: boolean = false;

    constructor(app: App, onChoose: (result: TFolder) => void, onCancel?: () => void) {
        super(app);
        this.onChoose = onChoose;
        this.onCancel = onCancel;
        this.setPlaceholder("Select a folder for export or deviation...");
    }

    getItems(): TFolder[] {
        const folders = this.app.vault.getAllFolders();
        return folders;
    }

    getItemText(item: TFolder): string {
        return item.isRoot() ? "/" : item.path;
    }

    onChooseItem(item: TFolder, _evt: MouseEvent | KeyboardEvent): void {
        this.itemChosen = true;
        this.onChoose(item);
    }

    onClose(): void {
        super.onClose();
        if (!this.itemChosen && this.onCancel) {
            this.onCancel();
        }
    }
}

export class VersionSuggest extends FuzzySuggestModal<DiffTarget> {
    private targets: DiffTarget[];
    onChoose: (result: DiffTarget) => void;
    onCancel?: () => void;
    private itemChosen: boolean = false;

    constructor(app: App, targets: DiffTarget[], onChoose: (result: DiffTarget) => void, onCancel?: () => void) {
        super(app);
        this.targets = targets;
        this.onChoose = onChoose;
        this.onCancel = onCancel;
        this.setPlaceholder("Select a version to compare against...");
    }

    getItems(): DiffTarget[] {
        return this.targets;
    }

    getItemText(target: DiffTarget): string {
        // FIX: Use a more robust type guard by checking for a property unique to VersionHistoryEntry.
        if ('versionNumber' in target) {
            const version = target; // Now correctly typed as VersionHistoryEntry
            const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;
            const timeLabel = moment(version.timestamp).format('YYYY-MM-DD HH:mm:ss');
            return `${versionLabel} (${timeLabel})`;
        } else {
            // It must be the CurrentNoteState type, where `name` is a required string.
            return target.name;
        }
    }

    renderSuggestion(match: FuzzyMatch<DiffTarget>, el: HTMLElement): void {
        const target = match.item; // Extract the actual item from the match object
        el.addClass('mod-complex');
        const content = el.createDiv('suggestion-content');
        const title = content.createDiv('suggestion-title');
        const note = content.createDiv('suggestion-note');

        // FIX: Use a more robust type guard by checking for a property unique to one of the union types.
        // The `in` operator provides a reliable way for TypeScript to discriminate the union.
        if ('versionNumber' in target) {
            const version = target; // TypeScript now knows this is a VersionHistoryEntry
            const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;
            title.setText(versionLabel);
            note.setText(moment(version.timestamp).format('LLLL'));
        } else {
            // It must be the CurrentNoteState type
            title.setText(target.name);
            note.setText('The current, unsaved content of the note.');
        }
    }

    onChooseItem(item: DiffTarget, _evt: MouseEvent | KeyboardEvent): void {
        this.itemChosen = true;
        this.onChoose(item);
    }

    onClose(): void {
        super.onClose();
        if (!this.itemChosen && this.onCancel) {
            this.onCancel();
        }
    }
}
