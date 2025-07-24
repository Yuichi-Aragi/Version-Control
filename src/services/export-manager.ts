import { App, TFile, TFolder, normalizePath } from "obsidian"; 
import { injectable, inject } from 'inversify';
import { VersionManager } from "../core/version-manager";
import type { VersionData, VersionHistoryEntry } from "../types";
import { TYPES } from "../types/inversify.types";

/**
 * Manages the business logic of exporting version history, such as data fetching,
 * formatting, and file writing. This class is a pure service and does not
 * create any UI elements.
 */
@injectable()
export class ExportManager {
    constructor(
        @inject(TYPES.App) private app: App, 
        @inject(TYPES.VersionManager) private versionManager: VersionManager
    ) {}

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
                // FIX: Conditionally add the 'name' property only if it exists.
                // This satisfies the 'exactOptionalPropertyTypes' compiler option by ensuring
                // 'name' is either a string or the property is omitted, but never explicitly undefined.
                return {
                    id: versionEntry.id,
                    noteId: versionEntry.noteId,
                    versionNumber: versionEntry.versionNumber,
                    timestamp: versionEntry.timestamp,
                    ...(versionEntry.name && { name: versionEntry.name }),
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
                    return `---\nversion_id: ${v.id}\nversion_number: ${v.versionNumber}\ntimestamp: "${v.timestamp}"\nname: "${v.name || ''}"\nsize_bytes: ${v.size}\n---\n\n${v.content}`;
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
                    return `Version ID: ${v.id}\nVersion Number: ${v.versionNumber}\nTimestamp: ${v.timestamp}\nName: ${v.name || 'N/A'}\nSize: ${v.size} bytes\n\n${v.content}`;
                }).join(versionsData.length > 1 ? '\n\n<<<<< VERSION END >>>>>\n\n<<<<< NEW VERSION START >>>>>\n\n' : '');
                break;
            default:
                // FIX: Removed the unused '_exhaustiveCheck' variable to resolve the TS6133 error.
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
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile instanceof TFile) {
                console.warn(`VC: File "${fileName}" already exists. Overwriting.`);
                await this.app.vault.modify(existingFile, content);
            } else {
                // If it exists but is a folder, this will fail, which is correct.
                await this.app.vault.create(filePath, content);
            }
            return filePath;
        } catch (error) {
            console.error(`Version Control: Failed to write export file "${filePath}".`, error);
            throw error;
        }
    }
}
