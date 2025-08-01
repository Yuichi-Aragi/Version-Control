import { App, normalizePath } from "obsidian";
import { trim, trimStart, trimEnd, isEmpty } from 'lodash-es';

/**
 * Generates a unique file path to avoid conflicts when creating new files.
 * Ensures the path is normalized.
 * @param app The Obsidian App instance.
 * @param baseName The desired base name for the file.
 * @param parentPath The path of the parent folder.
 * @returns A unique, normalized file path.
 */
export async function generateUniqueFilePath(app: App, baseName: string, parentPath?: string): Promise<string> {
    const extension = '.md';
    const folderPath: string = (parentPath && parentPath !== '/') ? parentPath : '';
    const base = folderPath ? `${folderPath}/` : '';
    
    // Use the robust customSanitizeFileName function for consistency and safety.
    const sanitizedBaseName = customSanitizeFileName(baseName);

    let fileName = sanitizedBaseName + extension;
    let filePath = normalizePath(base + fileName);
    let counter = 1;

    // Use the Vault API's getAbstractFileByPath, which returns a file object or null.
    // This is preferred over using the adapter's `exists` method directly.
    while (app.vault.getAbstractFileByPath(filePath)) {
        fileName = `${sanitizedBaseName} ${counter}${extension}`;
        filePath = normalizePath(base + fileName);
        counter++;
        if (counter > 1000) { // Safety break to prevent infinite loops
            console.error("Version Control: Could not generate unique file path after 1000 attempts for:", baseName, parentPath);
            throw new Error("Failed to generate unique file path.");
        }
    }

    return filePath;
}

/**
 * Sanitizes a string to be used as a valid filename across common operating systems.
 * This function attempts to remove or replace characters that are typically disallowed
 * in filenames on Windows, macOS, and Linux.
 *
 * @param name The string to sanitize.
 * @returns A sanitized string suitable for use as a filename (without extension).
 */
export function customSanitizeFileName(name: string): string {
    if (!name || trim(name) === "") {
        return "Untitled Export";
    }

    // 1. Remove control characters (ASCII 0-31 and 127-159)
    let sanitized: string = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

    // 2. Replace characters invalid in Windows/Unix/MacOS filenames with an underscore.
    // Also includes characters that might be problematic in URLs or paths.
    sanitized = sanitized.replace(/[\\/:*?"<>|#%&{}$!'"@+=`~]/g, '_');

    // 3. Handle reserved filenames on Windows (case-insensitive).
    // Check against the part before any potential extension-like dot.
    const parts = sanitized.split('.');
    const baseNamePartOnly = parts[0] || ''; // Explicitly handle possible undefined
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reservedNames.test(baseNamePartOnly)) {
        sanitized = `_${sanitized}`; 
    }

    // 4. Limit overall length to something reasonable (e.g., 200 chars)
    // OS limits are often around 255 *bytes*, this is a character approximation.
    const maxLength = 200; 
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
        // Avoid ending with an underscore if truncation caused it
        if (sanitized.endsWith('_')) {
            sanitized = sanitized.substring(0, sanitized.length -1);
        }
    }
    
    // 5. Remove leading/trailing dots, spaces, and underscores.
    sanitized = trim(sanitized);
    sanitized = trimStart(sanitized, '._ ');
    sanitized = trimEnd(sanitized, '._ ');
    sanitized = trim(sanitized); // Trim again after potential removals

    // 6. Replace multiple consecutive underscores with a single one
    sanitized = sanitized.replace(/_+/g, '_');

    // 7. If the name becomes empty or just underscores/dots after sanitization
    if (isEmpty(sanitized) || /^[_.]+$/.test(sanitized)) {
        return "Untitled Export";
    }

    return sanitized;
}
