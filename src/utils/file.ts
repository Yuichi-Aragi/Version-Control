import { App, normalizePath } from "obsidian"; // Added normalizePath

/**
 * Removes a specific key from a note's frontmatter.
 * @param content The content of the note.
 * @param key The key to remove.
 * @returns The content with the key removed.
 */
export function removeFrontmatterKey(content: string, key: string): string {
    const frontmatterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
        return content;
    }

    const frontmatterContent = match[1];
    // Regex to match the key, ensuring it's at the start of a line and handles various spacings and comments.
    // This is a simplified version; a full YAML parser would be more robust but heavier.
    const keyRegex = new RegExp(`^${key}:.*(\\n|$)`, 'm'); // 'm' for multiline
    
    let lines = frontmatterContent.split(/\r?\n/);
    lines = lines.filter(line => !keyRegex.test(line));
    
    const newFrontmatter = lines.filter(line => line.trim() !== '').join('\n');

    if (newFrontmatter.trim() === '') {
        // Remove entire frontmatter block if empty
        return content.replace(frontmatterRegex, '').trimStart(); // trimStart to keep leading content if FM was at very top
    }

    return content.replace(frontmatterRegex, `---\n${newFrontmatter}\n---`);
}

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
    const folderPath = parentPath && parentPath !== '/' ? parentPath : ''; // Treat '/' as root, meaning no prefix
    
    let fileName = baseName + extension;
    let filePath = folderPath ? normalizePath(`${folderPath}/${fileName}`) : normalizePath(fileName);
    let counter = 1;

    // Sanitize baseName once before loop to avoid repeated sanitization of growing string
    const sanitizedBaseName = baseName.replace(/[\\/:*?"<>|]/g, '_').trim();


    while (await app.vault.adapter.exists(filePath)) {
        fileName = `${sanitizedBaseName} ${counter}${extension}`;
        filePath = folderPath ? normalizePath(`${folderPath}/${fileName}`) : normalizePath(fileName);
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
    if (!name || name.trim() === "") {
        return "Untitled Export";
    }

    // 1. Remove control characters (ASCII 0-31 and 127-159)
    let sanitized = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

    // 2. Replace characters invalid in Windows/Unix/MacOS filenames with an underscore.
    // Also includes characters that might be problematic in URLs or paths.
    sanitized = sanitized.replace(/[\\/:*?"<>|#%&{}$!'"@+=`~]/g, '_');

    // 3. Handle reserved filenames on Windows (case-insensitive).
    // Check against the part before any potential extension-like dot.
    const baseNamePartOnly = sanitized.split('.')[0];
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
    
    // 5. Remove leading/trailing dots, spaces, and underscores
    sanitized = sanitized.trim();
    while (sanitized.startsWith('.') || sanitized.startsWith(' ') || sanitized.startsWith('_')) {
        sanitized = sanitized.substring(1);
    }
    while (sanitized.endsWith('.') || sanitized.endsWith(' ') || sanitized.endsWith('_')) {
        sanitized = sanitized.substring(0, sanitized.length - 1);
    }
    sanitized = sanitized.trim(); // Trim again after potential removals

    // 6. Replace multiple consecutive underscores with a single one
    sanitized = sanitized.replace(/_+/g, '_');

    // 7. If the name becomes empty or just underscores/dots after sanitization
    if (sanitized === "" || /^[_.]+$/.test(sanitized)) {
        return "Untitled Export";
    }

    return sanitized;
}