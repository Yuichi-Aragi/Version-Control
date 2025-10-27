import { App, TFile, TFolder, normalizePath } from "obsidian"; 
import { injectable, inject } from 'inversify';
import { z } from "zod";
import { VersionManager } from "../core/version-manager";
import type { VersionData, VersionHistoryEntry } from "../types";
import { VersionDataSchema } from "../schemas";
import { TYPES } from "../types/inversify.types";

/**
 * Manages the business logic of exporting version history, such as data fetching,
 * formatting, and file writing. This class is a pure service and does not
 * create any UI elements.
 */
@injectable()
export class ExportManager {
    private readonly MAX_CONCURRENT_FETCHES = 5; // Prevents resource exhaustion
    private readonly MAX_EXPORT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB safety cap

    constructor(
        @inject(TYPES.App) private readonly app: App, 
        @inject(TYPES.VersionManager) private readonly versionManager: VersionManager
    ) {}

    /**
     * Validates noteId before any operation
     */
    private validateNoteId(noteId: unknown): asserts noteId is string {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error(`Invalid noteId: must be non-empty string, received ${typeof noteId}`);
        }
        if (noteId.length > 1024) {
            throw new Error(`Invalid noteId: exceeds maximum length of 1024 characters`);
        }
    }

    /**
     * Validates folder parameter
     */
    private validateFolder(folder: unknown): asserts folder is TFolder {
        if (!folder || typeof folder !== 'object') {
            throw new Error('Invalid folder: must be a valid TFolder object');
        }
        if (!(folder instanceof TFolder)) {
            throw new Error('Invalid folder: not an instance of TFolder');
        }
        if (typeof folder.path !== 'string') {
            throw new Error('Invalid folder: path property must be a string');
        }
    }

    /**
     * Validates fileName parameter
     */
    private validateFileName(fileName: unknown): asserts fileName is string {
        if (typeof fileName !== 'string' || fileName.trim() === '') {
            throw new Error(`Invalid fileName: must be non-empty string, received ${typeof fileName}`);
        }
        // Security: prevent path traversal and invalid characters
        if (/[/\\:*?"<>|]/.test(fileName) || fileName.includes('\0')) {
            throw new Error('Invalid fileName: contains illegal characters');
        }
        if (fileName.length > 255) {
            throw new Error('Invalid fileName: exceeds maximum length of 255 characters');
        }
    }

    /**
     * Validates format parameter
     */
    private validateFormat(format: unknown): asserts format is 'md' | 'json' | 'ndjson' | 'txt' {
        const validFormats = ['md', 'json', 'ndjson', 'txt'] as const;
        if (typeof format !== 'string' || !validFormats.includes(format as any)) {
            throw new Error(`Invalid format: must be one of ${validFormats.join(', ')}, received ${format}`);
        }
    }

    /**
     * Validates content parameter
     */
    private validateContent(content: unknown): asserts content is string {
        if (typeof content !== 'string') {
            throw new Error(`Invalid content: must be string, received ${typeof content}`);
        }
        if (new TextEncoder().encode(content).length > this.MAX_EXPORT_SIZE_BYTES) {
            throw new Error(`Content exceeds maximum allowed size of ${this.MAX_EXPORT_SIZE_BYTES} bytes`);
        }
    }

    /**
     * Fetches all version data (including content) for a given note.
     * @param noteId The ID of the note.
     * @returns A promise that resolves to an array of `VersionData` objects.
     * @throws Error if noteId is invalid or operation fails
     */
    async getAllVersionsData(noteId: string): Promise<VersionData[]> {
        this.validateNoteId(noteId);

        try {
            const history: VersionHistoryEntry[] = await this.versionManager.getVersionHistory(noteId);
            
            if (!Array.isArray(history) || history.length === 0) {
                return [];
            }

            const results: VersionData[] = [];
            
            for (let i = 0; i < history.length; i += this.MAX_CONCURRENT_FETCHES) {
                const batch = history.slice(i, i + this.MAX_CONCURRENT_FETCHES);
                const batchPromises = batch.map(async (versionEntry) => {
                    if (!versionEntry || typeof versionEntry.id !== 'string' || versionEntry.id.trim() === '') {
                        return null;
                    }

                    try {
                        const content = await this.versionManager.getVersionContent(noteId, versionEntry.id);
                        const safeContent = typeof content === 'string' ? content : '';
                        
                        const versionData: VersionData = {
                            ...versionEntry,
                            content: safeContent,
                        };

                        // Validate with Zod before adding to results
                        VersionDataSchema.parse(versionData);
                        return versionData;

                    } catch (error) {
                        console.error(`Version Control: Failed to fetch or validate content for version ${versionEntry.id}:`, error);
                        return null;
                    }
                });

                const batchResults = await Promise.allSettled(batchPromises);
                
                for (const result of batchResults) {
                    if (result.status === 'fulfilled' && result.value !== null) {
                        results.push(result.value);
                    }
                }
            }

            return results;
        } catch (error) {
            console.error(`Version Control: Failed to fetch version history for note ${noteId}:`, error);
            throw new Error(`Failed to fetch version data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Formats an array of version data into a single string based on the specified format.
     * @param versionsData An array of `VersionData` to format.
     * @param format The target format ('md', 'json', 'ndjson', 'txt').
     * @returns The formatted string, or throws an error if the format is unknown.
     * @throws Error if parameters are invalid or formatting fails
     */
    public formatExportData(versionsData: VersionData[], format: 'md' | 'json' | 'ndjson' | 'txt'): string {
        this.validateFormat(format);
        
        // Use Zod to validate and sanitize the entire array at once.
        const validatedVersions = z.array(VersionDataSchema).parse(versionsData);

        try {
            let exportContent = "";

            switch (format) {
                case 'md': {
                    exportContent = validatedVersions.map(v => {
                        const name = v.name ?? '';
                        const escapedName = name.replace(/"/g, '\\"');
                        return `---\nversion_id: ${v.id}\nversion_number: ${v.versionNumber}\ntimestamp: "${v.timestamp}"\nname: "${escapedName}"\nsize_bytes: ${v.size}\n---\n\n${v.content}`;
                    }).join(validatedVersions.length > 1 ? '\n\n<!-- --- VERSION SEPARATOR --- -->\n\n' : '');
                    break;
                }
                case 'json': {
                    const dataToExport = validatedVersions.length === 1 ? validatedVersions[0] : validatedVersions;
                    exportContent = JSON.stringify(dataToExport, null, 2);
                    break;
                }
                case 'ndjson': {
                    if (validatedVersions.length === 0) {
                        exportContent = "";
                    } else if (validatedVersions.length === 1) {
                        exportContent = JSON.stringify(validatedVersions[0]);
                    } else {
                        exportContent = validatedVersions.map(v => JSON.stringify(v)).join('\n');
                    }
                    break;
                }
                case 'txt': {
                    exportContent = validatedVersions.map(v => {
                        const name = v.name ?? 'N/A';
                        return `Version ID: ${v.id}\nVersion Number: ${v.versionNumber}\nTimestamp: ${v.timestamp}\nName: ${name}\nSize: ${v.size} bytes\n\n${v.content}`;
                    }).join(validatedVersions.length > 1 ? '\n\n<<<<< VERSION END >>>>>\n\n<<<<< NEW VERSION START >>>>>\n\n' : '');
                    break;
                }
                default: {
                    throw new Error(`Unknown export format: ${format}`);
                }
            }

            if (new TextEncoder().encode(exportContent).length > this.MAX_EXPORT_SIZE_BYTES) {
                throw new Error(`Formatted export exceeds maximum size of ${this.MAX_EXPORT_SIZE_BYTES} bytes`);
            }

            return exportContent;
        } catch (error) {
            console.error(`Version Control: Failed to format export data:`, error);
            throw new Error(`Formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Writes content to a file in the vault, handling conflicts.
     * @param folder The target folder for the export.
     * @param fileName The desired name of the file.
     * @param content The string content to write.
     * @returns The full path of the created file.
     * @throws Error if parameters are invalid or write operation fails
     */
    public async writeFile(folder: TFolder, fileName: string, content: string): Promise<string> {
        this.validateFolder(folder);
        this.validateFileName(fileName);
        this.validateContent(content);

        try {
            const folderPath = folder.isRoot() ? '' : folder.path;
            let filePath = normalizePath(`${folderPath}/${fileName}`);
            
            if (filePath.includes('../') || filePath.includes('..\\')) {
                throw new Error('Invalid file path: contains directory traversal');
            }
            
            if (filePath.startsWith('.git/') || filePath.startsWith('.obsidian/')) {
                throw new Error('Cannot write to protected system directories');
            }

            let resultPath: string;
            
            try {
                const existingFile = this.app.vault.getAbstractFileByPath(filePath);
                
                if (existingFile instanceof TFile) {
                    console.warn(`VC: File "${fileName}" already exists. Overwriting.`);
                    await this.app.vault.modify(existingFile, content);
                    resultPath = filePath;
                } else if (existingFile instanceof TFolder) {
                    throw new Error(`Cannot write file: path "${filePath}" is a directory`);
                } else {
                    await this.app.vault.create(filePath, content);
                    resultPath = filePath;
                }
            } catch (fileError) {
                console.warn(`VC: Direct file creation failed, attempting with unique filename:`, fileError);
                
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const nameParts = fileName.split('.');
                const extension = nameParts.length > 1 ? nameParts.pop() : '';
                const baseName = nameParts.join('.');
                const uniqueFileName = extension 
                    ? `${baseName}-${timestamp}.${extension}` 
                    : `${baseName}-${timestamp}`;
                
                filePath = normalizePath(`${folderPath}/${uniqueFileName}`);
                await this.app.vault.create(filePath, content);
                resultPath = filePath;
                
                console.info(`VC: Created file with unique name: ${uniqueFileName}`);
            }

            return resultPath;
        } catch (error) {
            console.error(`Version Control: Failed to write export file:`, error);
            throw new Error(`File write failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
