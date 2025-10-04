import { App, normalizePath } from "obsidian";
import { trim, trimStart, trimEnd, isEmpty } from 'lodash-es';

// Constants for better maintainability and magic number elimination
const DEFAULT_FILENAME = "Untitled Export";
const MAX_ATTEMPTS = 1000;
const EXTENSION = '.md';
const MAX_FILENAME_LENGTH = 200;
const RESERVED_NAMES_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const INVALID_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f\\/:*?"<>|#%&{}$!'"@+=`~\[\]\(\)]/g;
const MULTIPLE_UNDERSCORES_REGEX = /_+/g;
const EMPTY_OR_INVALID_CHARS_REGEX = /^[_.\s]+$/;

// Type definitions for better type safety
type FilePath = string;
type ParentPath = string | undefined;

// Cache for frequently accessed paths to improve performance
const pathExistsCache = new Map<FilePath, boolean>();
const CACHE_MAX_SIZE = 1000;

/**
 * Validates the App instance with comprehensive checks
 * @param app The App instance to validate
 * @throws TypeError if validation fails
 */
function validateAppInstance(app: App): void {
    if (!app) {
        throw new TypeError('App instance is required');
    }

    if (typeof app !== 'object') {
        throw new TypeError('App must be an object');
    }

    if (!app.vault) {
        throw new TypeError('App instance must have a vault property');
    }

    if (typeof app.vault.getAbstractFileByPath !== 'function') {
        throw new TypeError('Invalid App instance: vault.getAbstractFileByPath method missing');
    }
}

/**
 * Validates and normalizes the parent path
 * @param parentPath The parent path to validate
 * @returns Normalized folder path
 */
function validateAndNormalizeParentPath(parentPath: ParentPath): string {
    if (parentPath === undefined || parentPath === null || parentPath === '/') {
        return '';
    }

    // Defensive: ensure parentPath is string and trim whitespace
    const folderPath = String(parentPath).trim();

    // Normalize path separators and handle edge cases
    if (folderPath === '.' || folderPath === './') {
        return '';
    }

    // Return as-is (generateUniqueFilePath will call normalizePath later)
    return folderPath;
}

/**
 * Checks if a file exists at the given path with caching for performance
 * @param app The App instance
 * @param filePath The path to check (optional)
 * @returns True if file exists, false otherwise
 */
function fileExistsWithCache(app: App, filePath?: string): boolean {
    if (!filePath) return false;

    const normalizedPath = normalizePath(String(filePath));

    // Check cache first
    if (pathExistsCache.has(normalizedPath)) {
        return pathExistsCache.get(normalizedPath)!;
    }

    // Check actual file existence
    const exists = app.vault.getAbstractFileByPath(normalizedPath) !== null;

    // Update cache (with size limit to prevent memory leaks)
    if (pathExistsCache.size >= CACHE_MAX_SIZE) {
        // Clear oldest entries (simple LRU-ish: remove first key)
        const firstKey = pathExistsCache.keys().next().value;
        if (firstKey !== undefined) {
            pathExistsCache.delete(firstKey);
        } else {
            pathExistsCache.clear();
        }
    }
    pathExistsCache.set(normalizedPath, exists);

    return exists;
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
    // === STRICT INPUT VALIDATION ===
    validateAppInstance(app);

    if (typeof baseName !== 'string') {
        throw new TypeError('baseName must be a string');
    }

    if (parentPath !== undefined && typeof parentPath !== 'string') {
        throw new TypeError('parentPath must be a string or undefined');
    }

    // === PATH NORMALIZATION AND VALIDATION ===
    const folderPath = validateAndNormalizeParentPath(parentPath);
    const base = folderPath ? `${folderPath}/` : '';

    // Use the robust customSanitizeFileName function for consistency and safety.
    const sanitizedBaseName = customSanitizeFileName(baseName);

    // === ATTEMPT GENERATION WITH STRICT BOUNDS ===
    let counter = 1;
    let fileName: string;
    let filePath: string;

    // First attempt without counter
    fileName = sanitizedBaseName + EXTENSION;
    filePath = normalizePath(String(base + fileName));

    // Validate normalized path
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Path normalization failed');
    }

    // Check for existence with safety limit
    while (counter <= MAX_ATTEMPTS) {
        try {
            // Use cached file existence check for better performance
            const fileExists = fileExistsWithCache(app, filePath);

            if (!fileExists) {
                return filePath; // Success: unique path found
            }

            // Generate next candidate
            counter++;
            fileName = `${sanitizedBaseName} ${counter}${EXTENSION}`;
            const candidatePath = base + fileName;

            // Re-normalize each iteration (defensive against path manipulation)
            filePath = normalizePath(String(candidatePath));

            // Validate after normalization
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('Path normalization failed during iteration');
            }
        } catch (error) {
            console.error("Version Control: Error during unique file path generation:", {
                baseName,
                parentPath: parentPath ?? 'N/A',
                attempt: counter,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error(`Failed to generate unique file path: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // === FAILURE CASE ===
    const errorMsg = `Could not generate unique file path after ${MAX_ATTEMPTS} attempts for baseName: "${baseName}", parentPath: "${parentPath || ''}"`;
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
export function customSanitizeFileName(name: unknown): string {
    // === STRICT INPUT VALIDATION ===
    if (name === null || name === undefined) {
        return DEFAULT_FILENAME;
    }

    // Ensure we're working with a string
    const inputName = String(name);

    // Early return for empty/whitespace-only strings
    if (trim(inputName) === "") {
        return DEFAULT_FILENAME;
    }

    try {
        // === SANITIZATION STEPS ===
        let sanitized: string = inputName;

        // 1. Remove control characters and invalid filesystem characters
        sanitized = sanitized.replace(INVALID_CHARS_REGEX, '_');

        // 2. Handle reserved filenames on Windows (case-insensitive).
        // Check against the part before any potential extension-like dot.
        const parts = sanitized.split('.');
        const baseNamePartOnly = parts[0] || ''; // Explicitly handle possible undefined

        if (RESERVED_NAMES_REGEX.test(baseNamePartOnly)) {
            sanitized = `_${sanitized}`;
        }

        // 3. Limit overall length to something reasonable (e.g., 200 chars)
        if (sanitized.length > MAX_FILENAME_LENGTH) {
            sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
            // Avoid ending with an underscore if truncation caused it
            if (sanitized.endsWith('_')) {
                sanitized = sanitized.substring(0, sanitized.length - 1);
            }
            // Also avoid ending with dot or space after truncation
            sanitized = trimEnd(sanitized, '._ ');
        }

        // 4. Remove leading/trailing dots, spaces, and underscores.
        sanitized = trim(sanitized);
        sanitized = trimStart(sanitized, '._ ');
        sanitized = trimEnd(sanitized, '._ ');
        sanitized = trim(sanitized); // Trim again after potential removals

        // 5. Replace multiple consecutive underscores with a single one
        sanitized = sanitized.replace(MULTIPLE_UNDERSCORES_REGEX, '_');

        // 6. If the name becomes empty or just underscores/dots after sanitization
        if (isEmpty(sanitized) || EMPTY_OR_INVALID_CHARS_REGEX.test(sanitized)) {
            return DEFAULT_FILENAME;
        }

        // Final validation: ensure we have a non-empty, non-whitespace string
        const finalResult = sanitized;
        if (!finalResult || trim(finalResult) === '') {
            return DEFAULT_FILENAME;
        }

        return finalResult;
    } catch (error) {
        console.error("Filename sanitization failed:", {
            originalName: name,
            error: error instanceof Error ? error.message : String(error)
        });
        return DEFAULT_FILENAME;
    }
}

/**
 * Clears the internal path existence cache. Useful for testing or when the file system changes outside of Obsidian.
 */
export function clearPathExistsCache(): void {
    pathExistsCache.clear();
}

/**
 * Gets the current size of the path existence cache. Useful for monitoring memory usage.
 * @returns The number of entries in the cache.
 */
export function getPathExistsCacheSize(): number {
    return pathExistsCache.size;
}
