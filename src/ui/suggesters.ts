import { App, TFolder, FuzzySuggestModal } from "obsidian";

export class FolderSuggest extends FuzzySuggestModal<TFolder> {
    onChoose: (result: TFolder) => void;

    constructor(app: App, onChoose: (result: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
    }

    getItems(): TFolder[] {
        return this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder) as TFolder[];
    }

    getItemText(item: TFolder): string {
        return item.path;
    }

    onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}