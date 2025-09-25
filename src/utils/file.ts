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
    // === STRICT INPUT VALIDATION ===
    if (!app) {
        throw new TypeError('App instance is required');
    }
    if (typeof app.vault?.getAbstractFileByPath !== 'function') {
        throw new TypeError('Invalid App instance: vault.getAbstractFileByPath method missing');
    }
    if (typeof baseName !== 'string') {
        throw new TypeError('baseName must be a string');
    }
    if (parentPath !== undefined && typeof parentPath !== 'string') {
        throw new TypeError('parentPath must be a string or undefined');
    }

    // === CONSTANTS ===
    const MAX_ATTEMPTS = 1000;
    const EXTENSION = '.md';
    
    // === PATH NORMALIZATION AND VALIDATION ===
    let folderPath: string;
    if (parentPath === undefined || parentPath === null || parentPath === '/') {
        folderPath = '';
    } else {
        // Defensive: ensure parentPath is string and trim whitespace
        folderPath = String(parentPath).trim();
        // Normalize path separators and handle edge cases
        if (folderPath === '.' || folderPath === './') {
            folderPath = '';
        }
    }

    const base = folderPath ? `${folderPath}/` : '';
    
    // Use the robust customSanitizeFileName function for consistency and safety.
    const sanitizedBaseName = customSanitizeFileName(baseName);

    // === ATTEMPT GENERATION WITH STRICT BOUNDS ===
    let counter = 1;
    let fileName: string;
    let filePath: string;

    // First attempt without counter
    fileName = sanitizedBaseName + EXTENSION;
    filePath = normalizePath(base + fileName);

    // Validate normalized path
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Path normalization failed');
    }

    // Check for existence with safety limit
    while (counter <= MAX_ATTEMPTS) {
        try {
            // Use Vault API - this is the correct Obsidian method
            const fileExists = app.vault.getAbstractFileByPath(filePath) !== null;
            
            if (!fileExists) {
                return filePath; // Success: unique path found
            }
            
            // Generate next candidate
            counter++;
            fileName = `${sanitizedBaseName} ${counter}${EXTENSION}`;
            const candidatePath = base + fileName;
            
            // Re-normalize each iteration (defensive against path manipulation)
            filePath = normalizePath(candidatePath);
            
            // Validate after normalization
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('Path normalization failed during iteration');
            }
            
        } catch (error) {
            console.error("Version Control: Error during unique file path generation:", {
                baseName,
                parentPath,
                attempt: counter,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error(`Failed to generate unique file path: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // === FAILURE CASE ===
    const errorMsg = `Could not generate unique file path after ${MAX_ATTEMPTS} attempts for baseName: "${baseName}", parentPath: "${parentPath}"`;
    console.error("Version Control: " + errorMsg);
    throw new Error(errorMsg);
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
    // === STRICT INPUT VALIDATION ===
    if (name === null || name === undefined) {
        return "Untitled Export";
    }
    
    // Ensure we're working with a string
    const inputName = String(name);
    
    // Early return for empty/whitespace-only strings
    if (trim(inputName) === "") {
        return "Untitled Export";
    }

    try {
        // === SANITIZATION STEPS ===
        let sanitized: string = inputName;

        // 1. Remove control characters (ASCII 0-31 and 127-159)
        sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

        // 2. Replace characters invalid in Windows/Unix/MacOS filenames with an underscore.
        // Also includes characters that might be problematic in URLs or paths.
        sanitized = sanitized.replace(/[\\/:*?"<>|#%&{}$!'"@+=`~\[\]\(\)]/g, '_');

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
                sanitized = sanitized.substring(0, sanitized.length - 1);
            }
            // Also avoid ending with dot or space after truncation
            sanitized = trimEnd(sanitized, '._ ');
        }
        
        // 5. Remove leading/trailing dots, spaces, and underscores.
        sanitized = trim(sanitized);
        sanitized = trimStart(sanitized, '._ ');
        sanitized = trimEnd(sanitized, '._ ');
        sanitized = trim(sanitized); // Trim again after potential removals

        // 6. Replace multiple consecutive underscores with a single one
        sanitized = sanitized.replace(/_+/g, '_');

        // 7. If the name becomes empty or just underscores/dots after sanitization
        if (isEmpty(sanitized) || /^[_.\s]+$/.test(sanitized)) {
            return "Untitled Export";
        }

        // Final validation: ensure we have a non-empty, non-whitespace string
        const finalResult = sanitized;
        if (!finalResult || trim(finalResult) === '') {
            return "Untitled Export";
        }

        return finalResult;
        
    } catch (error) {
        console.error("Filename sanitization failed:", {
            originalName: name,
            error: error instanceof Error ? error.message : String(error)
        });
        return "Untitled Export";
    }
}
