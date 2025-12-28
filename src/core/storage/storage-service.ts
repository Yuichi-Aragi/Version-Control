import { App, TFolder, Vault } from "obsidian";
import { executeWithRetry } from "@/utils/retry";

/**
 * A low-level service for direct, robust interactions with the vault's file system adapter.
 * Uses shared retry logic for resilience.
 */
export class StorageService {
    private vault: Vault;

    constructor(app: App) {
        this.vault = app.vault;
    }

    public async ensureFolderExists(path: string): Promise<void> {
        await executeWithRetry(
            async () => {
                const item = this.vault.getAbstractFileByPath(path);
                if (item) {
                    if (item instanceof TFolder) return;
                    throw new Error(`A file exists at the required folder path "${path}".`);
                }

                try {
                    await this.vault.createFolder(path);
                } catch (error) {
                    if (error instanceof Error && error.message.includes('Folder already exists')) {
                        const stat = await this.vault.adapter.stat(path);
                        if (stat?.type === 'folder') return;
                        if (stat?.type === 'file') throw new Error(`A file exists at the required folder path "${path}".`);
                    }
                    throw error;
                }
            },
            {
                context: `ensureFolderExists:${path}`,
                validateSuccess: async () => {
                    const stat = await this.vault.adapter.stat(path);
                    return stat?.type === 'folder';
                }
            }
        );
    }

    public async permanentlyDeleteFolder(path: string): Promise<void> {
        await executeWithRetry(
            async () => {
                const exists = await this.vault.adapter.exists(path);
                if (exists) {
                    try {
                        await this.vault.adapter.rmdir(path, true);
                    } catch (error) {
                        const stillExists = await this.vault.adapter.exists(path);
                        if (!stillExists) return;
                        throw error;
                    }
                }
            },
            {
                context: `permanentlyDeleteFolder:${path}`,
                validateSuccess: async () => {
                    const exists = await this.vault.adapter.exists(path);
                    return !exists;
                }
            }
        );
    }

    public async renameFolder(oldPath: string, newPath: string): Promise<void> {
        await executeWithRetry(
            async () => {
                const sourceExists = await this.vault.adapter.exists(oldPath);
                const targetExists = await this.vault.adapter.exists(newPath);

                if (!sourceExists) {
                    if (targetExists) return;
                    throw new Error(`Source folder "${oldPath}" does not exist.`);
                }
                if (targetExists) throw new Error(`Destination path "${newPath}" already exists.`);

                try {
                    await this.vault.adapter.rename(oldPath, newPath);
                } catch (error) {
                    const s = await this.vault.adapter.exists(oldPath);
                    const t = await this.vault.adapter.exists(newPath);
                    if (!s && t) return;
                    throw error;
                }
            },
            {
                context: `renameFolder:${oldPath}->${newPath}`,
                validateSuccess: async () => {
                    const sourceExists = await this.vault.adapter.exists(oldPath);
                    const targetExists = await this.vault.adapter.exists(newPath);
                    return !sourceExists && targetExists;
                }
            }
        );
    }
}
