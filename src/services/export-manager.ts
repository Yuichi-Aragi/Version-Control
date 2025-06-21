import { App, Notice, TFolder, Menu, normalizePath } from "obsidian";
import { VersionManager } from "../core/version-manager";
import { VersionData } from "../types";
import { FolderSuggest } from "../ui/suggesters";

export class ExportManager {
    app: App;
    versionManager: VersionManager;

    constructor(app: App, versionManager: VersionManager) {
        this.app = app;
        this.versionManager = versionManager;
    }

    showExportMenu(noteId: string, noteName: string, event: MouseEvent) {
        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle("Markdown (.md)")
                .setIcon("file-text")
                .onClick(() => this.exportVersions(noteId, noteName, "md"))
        );
        menu.addItem((item) =>
            item
                .setTitle("JSON")
                .setIcon("braces")
                .onClick(() => this.exportVersions(noteId, noteName, "json"))
        );
        menu.addItem((item) =>
            item
                .setTitle("NDJSON")
                .setIcon("list-ordered")
                .onClick(() => this.exportVersions(noteId, noteName, "ndjson"))
        );
        menu.addItem((item) =>
            item
                .setTitle("Plain Text (.txt)")
                .setIcon("file-text")
                .onClick(() => this.exportVersions(noteId, noteName, "txt"))
        );
        menu.showAtMouseEvent(event);
    }

    async exportVersions(noteId: string, noteName: string, format: 'md' | 'json' | 'ndjson' | 'txt') {
        new FolderSuggest(this.app, async (folder: TFolder) => {
            try {
                new Notice(`Exporting versions for "${noteName}"...`);
                const history = await this.versionManager.getVersionHistory(noteId);
                if (!history.length) {
                    new Notice("No versions to export.");
                    return;
                }

                const versionsData: VersionData[] = await Promise.all(
                    history.map(async (v) => ({
                        ...v,
                        noteId,
                        content: (await this.versionManager.getVersionContent(noteId, v.id)) || "",
                    }))
                );

                let exportContent = "";
                let fileExtension = format;

                switch (format) {
                    case 'md':
                        exportContent = versionsData.map(v => 
                            `---\nversion: ${v.id}\ntimestamp: ${v.timestamp}\nname: ${v.name || ''}\n---\n\n${v.content}`
                        ).join('\n\n---\n\n');
                        break;
                    case 'json':
                        exportContent = JSON.stringify(versionsData, null, 2);
                        break;
                    case 'ndjson':
                        exportContent = versionsData.map(v => JSON.stringify(v)).join('\n');
                        fileExtension = 'ndjson';
                        break;
                    case 'txt':
                        exportContent = versionsData.map(v => v.content).join('\n\n---\n\n');
                        break;
                }

                const fileName = `Version History - ${noteName}.${fileExtension}`;
                const filePath = normalizePath(`${folder.path}/${fileName}`);
                
                await this.app.vault.create(filePath, exportContent);
                new Notice(`Successfully exported to ${filePath}`);

            } catch (error) {
                console.error("Version Control: Export failed", error);
                new Notice("Error: Failed to export versions. Check console for details.");
            }
        }).open();
    }
}