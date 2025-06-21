import { App } from "obsidian";

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
    const keyRegex = new RegExp(`^${key}:.*$`, 'gm');
    const newFrontmatter = frontmatterContent
        .replace(keyRegex, '')
        .split('\n')
        .filter(line => line.trim() !== '')
        .join('\n');

    if (newFrontmatter.trim() === '') {
        // Remove entire frontmatter block if empty
        return content.replace(frontmatterRegex, '').trim();
    }

    return content.replace(frontmatterRegex, `---\n${newFrontmatter}\n---`);
}

/**
 * Generates a unique file path to avoid conflicts when creating new files.
 * @param app The Obsidian App instance.
 * @param baseName The desired base name for the file.
 * @param parentPath The path of the parent folder.
 * @returns A unique file path.
 */
export async function generateUniqueFilePath(app: App, baseName: string, parentPath?: string): Promise<string> {
    const extension = '.md';
    const folderPath = parentPath || '';
    
    let fileName = baseName + extension;
    let filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    let counter = 1;

    while (await app.vault.adapter.exists(filePath)) {
        fileName = `${baseName} ${counter}${extension}`;
        filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
        counter++;
    }

    return filePath;
}