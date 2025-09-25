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
        // ✅ FIXED: Replaced Buffer with TextEncoder
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
        // Proactive validation
        this.validateNoteId(noteId);

        try {
            const history: VersionHistoryEntry[] = await this.versionManager.getVersionHistory(noteId);
            
            // Handle null/undefined and empty cases explicitly
            if (!Array.isArray(history) || history.length === 0) {
                return [];
            }

            // Validate history entries
            for (const entry of history) {
                if (!entry || typeof entry !== 'object') {
                    console.warn('Version Control: Invalid history entry encountered, skipping');
                    continue;
                }
                if (typeof entry.id !== 'string' || entry.id.trim() === '') {
                    console.warn('Version Control: History entry missing valid id, skipping');
                    continue;
                }
            }

            // Process with controlled concurrency to prevent resource exhaustion
            const results: VersionData[] = [];
            
            for (let i = 0; i < history.length; i += this.MAX_CONCURRENT_FETCHES) {
                const batch = history.slice(i, i + this.MAX_CONCURRENT_FETCHES);
                const batchPromises = batch.map(async (versionEntry) => {
                    // Skip invalid entries
                    if (!versionEntry || typeof versionEntry.id !== 'string' || versionEntry.id.trim() === '') {
                        return null;
                    }

                    try {
                        const content = await this.versionManager.getVersionContent(noteId, versionEntry.id);
                        
                        // Ensure content is always a string, handle null/undefined cases
                        const safeContent = typeof content === 'string' ? content : '';
                        
                        // ✅ FIXED: Replaced Buffer with TextEncoder
                        const contentByteLength = new TextEncoder().encode(safeContent).length;

                        // Build result object with conditional properties
                        const result: VersionData = {
                            id: versionEntry.id,
                            noteId: versionEntry.noteId ?? noteId, // Fallback to provided noteId
                            versionNumber: typeof versionEntry.versionNumber === 'number' ? versionEntry.versionNumber : 0,
                            timestamp: versionEntry.timestamp ?? new Date().toISOString(),
                            content: safeContent,
                            size: typeof versionEntry.size === 'number' ? versionEntry.size : contentByteLength
                        };
                        
                        // Conditionally add name only if it exists and is a string
                        if (typeof versionEntry.name === 'string' && versionEntry.name.trim() !== '') {
                            result.name = versionEntry.name;
                        }
                        
                        return result;
                    } catch (error) {
                        console.error(`Version Control: Failed to fetch content for version ${versionEntry.id}:`, error);
                        return null; // Return null for failed entries, filter them out later
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
        // Proactive validation
        if (!Array.isArray(versionsData)) {
            throw new Error('Invalid versionsData: must be an array');
        }
        this.validateFormat(format);

        try {
            // Defensive handling of potentially malformed version data
            const sanitizedVersions = versionsData.map(v => {
                if (!v || typeof v !== 'object') {
                    console.warn('Version Control: Invalid version data encountered, sanitizing');
                    return {
                        id: 'unknown',
                        noteId: 'unknown',
                        versionNumber: 0,
                        timestamp: new Date().toISOString(),
                        size: 0,
                        content: ''
                    };
                }
                
                return {
                    id: typeof v.id === 'string' ? v.id : 'unknown',
                    noteId: typeof v.noteId === 'string' ? v.noteId : 'unknown',
                    versionNumber: typeof v.versionNumber === 'number' ? v.versionNumber : 0,
                    timestamp: typeof v.timestamp === 'string' ? v.timestamp : new Date().toISOString(),
                    size: typeof v.size === 'number' ? v.size : 0,
                    content: typeof v.content === 'string' ? v.content : '',
                    ...(typeof v.name === 'string' && v.name.trim() !== '' ? { name: v.name } : {})
                };
            });

            let exportContent = "";

            switch (format) {
                case 'md': {
                    exportContent = sanitizedVersions.map(v => {
                        const name = v.name && typeof v.name === 'string' ? v.name : '';
                        const escapedName = name.replace(/"/g, '\\"');
                        return `---\nversion_id: ${v.id}\nversion_number: ${v.versionNumber}\ntimestamp: "${v.timestamp}"\nname: "${escapedName}"\nsize_bytes: ${v.size}\n---\n\n${v.content}`;
                    }).join(sanitizedVersions.length > 1 ? '\n\n<!-- --- VERSION SEPARATOR --- -->\n\n' : '');
                    break;
                }
                case 'json': {
                    const dataToExport = sanitizedVersions.length === 1 ? sanitizedVersions[0] : sanitizedVersions;
                    exportContent = JSON.stringify(dataToExport, null, 2);
                    break;
                }
                case 'ndjson': {
                    if (sanitizedVersions.length === 0) {
                        exportContent = "";
                    } else if (sanitizedVersions.length === 1) {
                        exportContent = JSON.stringify(sanitizedVersions[0]);
                    } else {
                        exportContent = sanitizedVersions.map(v => JSON.stringify(v)).join('\n');
                    }
                    break;
                }
                case 'txt': {
                    exportContent = sanitizedVersions.map(v => {
                        const name = v.name && typeof v.name === 'string' ? v.name : 'N/A';
                        return `Version ID: ${v.id}\nVersion Number: ${v.versionNumber}\nTimestamp: ${v.timestamp}\nName: ${name}\nSize: ${v.size} bytes\n\n${v.content}`;
                    }).join(sanitizedVersions.length > 1 ? '\n\n<<<<< VERSION END >>>>>\n\n<<<<< NEW VERSION START >>>>>\n\n' : '');
                    break;
                }
                default: {
                    // This should never be reached due to validation, but included for type safety
                    throw new Error(`Unknown export format: ${format}`);
                }
            }

            // ✅ FIXED: Replaced Buffer with TextEncoder
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
        // Proactive validation
        this.validateFolder(folder);
        this.validateFileName(fileName);
        this.validateContent(content);

        try {
            const folderPath = folder.isRoot() ? '' : folder.path;
            // Security: normalize and validate path construction
            let filePath = normalizePath(`${folderPath}/${fileName}`);
            
            // Additional security validation on final path
            if (filePath.includes('../') || filePath.includes('..\\')) {
                throw new Error('Invalid file path: contains directory traversal');
            }
            
            // Check if we're trying to write to a protected system location
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
                    // File doesn't exist, create it
                    await this.app.vault.create(filePath, content);
                    resultPath = filePath;
                }
            } catch (fileError) {
                // Handle case where file creation might fail due to path issues
                console.warn(`VC: Direct file creation failed, attempting with unique filename:`, fileError);
                
                // Generate unique filename by appending timestamp
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
