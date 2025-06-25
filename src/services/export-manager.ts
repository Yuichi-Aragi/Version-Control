import { App, TFolder, normalizePath } from "obsidian"; 
import { VersionManager } from "../core/version-manager";
import { VersionData, VersionHistoryEntry } from "../types";

/**
 * Manages the business logic of exporting version history, such as data fetching,
 * formatting, and file writing. This class is a pure service and does not
 * create any UI elements.
 */
export class ExportManager {
    private app: App;
    private versionManager: VersionManager;

    constructor(app: App, versionManager: VersionManager) {
        this.app = app;
        this.versionManager = versionManager;
    }

    /**
     * Fetches all version data (including content) for a given note.
     * @param noteId The ID of the note.
     * @returns A promise that resolves to an array of `VersionData` objects.
     */
    async getAllVersionsData(noteId: string): Promise<VersionData[]> {
        const history: VersionHistoryEntry[] = await this.versionManager.getVersionHistory(noteId);
        if (!history || history.length === 0) {
            return [];
        }

        return Promise.all(
            history.map(async (versionEntry) => {
                const content = await this.versionManager.getVersionContent(noteId, versionEntry.id);
                return {
                    id: versionEntry.id,
                    noteId: versionEntry.noteId,
                    versionNumber: versionEntry.versionNumber,
                    timestamp: versionEntry.timestamp,
                    name: versionEntry.name,
                    tags: versionEntry.tags,
                    size: versionEntry.size,
                    content: content || "", // Ensure content is always a string
                };
            })
        );
    }

    /**
     * Formats an array of version data into a single string based on the specified format.
     * @param versionsData An array of `VersionData` to format.
     * @param format The target format ('md', 'json', 'ndjson', 'txt').
     * @returns The formatted string, or `null` if the format is unknown.
     */
    public formatExportData(versionsData: VersionData[], format: 'md' | 'json' | 'ndjson' | 'txt'): string | null {
        let exportContent = "";
        switch (format) {
            case 'md':
                exportContent = versionsData.map(v => {
                    const tagsYaml = (v.tags && v.tags.length > 0) ? `tags: [${v.tags.join(', ')}]\n` : '';
                    return `---\nversion_id: ${v.id}\nversion_number: ${v.versionNumber}\ntimestamp: "${v.timestamp}"\nname: "${v.name || ''}"\n${tagsYaml}size_bytes: ${v.size}\n---\n\n${v.content}`;
                }).join(versionsData.length > 1 ? '\n\n<!-- --- VERSION SEPARATOR --- -->\n\n' : '');
                break;
            case 'json':
                exportContent = JSON.stringify(versionsData.length === 1 ? versionsData[0] : versionsData, null, 2); 
                break;
            case 'ndjson':
                if (versionsData.length === 1 && format === 'ndjson') {
                    exportContent = JSON.stringify(versionsData[0]);
                } else {
                    exportContent = versionsData.map(v => JSON.stringify(v)).join('\n');
                }
                break;
            case 'txt':
                exportContent = versionsData.map(v => {
                    const tagsText = (v.tags && v.tags.length > 0) ? `Tags: ${v.tags.map(t => `#${t}`).join(' ')}\n` : '';
                    return `Version ID: ${v.id}\nVersion Number: ${v.versionNumber}\nTimestamp: ${v.timestamp}\nName: ${v.name || 'N/A'}\n${tagsText}Size: ${v.size} bytes\n\n${v.content}`;
                }).join(versionsData.length > 1 ? '\n\n<<<<< VERSION END >>>>>\n\n<<<<< NEW VERSION START >>>>>\n\n' : '');
                break;
            default:
                const _exhaustiveCheck: never = format; 
                console.error(`Version Control: Unknown export format encountered: ${format}`);
                return null;
        }
        return exportContent;
    }

    /**
     * Writes content to a file in the vault, handling conflicts.
     * @param folder The target folder for the export.
     * @param fileName The desired name of the file.
     * @param content The string content to write.
     * @returns The full path of the created file.
     */
    public async writeFile(folder: TFolder, fileName: string, content: string): Promise<string> {
        const folderPath = folder.isRoot() ? '' : folder.path;
        let filePath = normalizePath(`${folderPath}/${fileName}`);
        
        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                console.log(`VC: File "${fileName}" already exists. Overwriting.`);
            }
            // `create` can overwrite, which is what we want.
            await this.app.vault.create(filePath, content);
            return filePath;
        } catch (error) {
            console.error(`Version Control: Failed to write export file "${filePath}".`, error);
            throw error;
        }
    }
}
