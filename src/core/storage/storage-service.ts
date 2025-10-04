import { App, TFolder, Vault } from "obsidian";
import { injectable, inject } from 'inversify';
import { TYPES } from "../../types/inversify.types";

/**
 * A low-level service for direct, robust interactions with the vault's file system adapter.
 * It encapsulates common, potentially risky file operations like recursive deletion and
 * folder creation, providing a centralized and resilient implementation.
 */
@injectable()
export class StorageService {
    private vault: Vault;

    constructor(@inject(TYPES.App) app: App) {
        this.vault = app.vault;
    }

    /**
     * Ensures a folder exists at the specified path. If it doesn't, it's created.
     * Throws an error if a file exists at the path instead of a folder.
     * @param path The full path of the folder to ensure existence of.
     */
    public async ensureFolderExists(path: string): Promise<void> {
        const item = this.vault.getAbstractFileByPath(path);
    
        if (item) {
            if (item instanceof TFolder) {
                return; // Folder already exists, nothing to do.
            } else {
                // A file exists where we need a folder. This is a critical, unrecoverable state.
                throw new Error(`A file exists at the required folder path "${path}". Please remove it and restart the plugin.`);
            }
        }
    
        try {
            await this.vault.createFolder(path);
        } catch (error) {
            // Handle race condition where folder was created between the check and the create call.
            if (error instanceof Error && error.message.includes('Folder already exists')) {
                return;
            }
            console.error(`VC: Critical error while trying to create folder at "${path}".`, error);
            throw error; // Re-throw to be handled by the calling service.
        }
    }

    /**
     * Permanently and recursively deletes a folder using the vault adapter.
     * This bypasses Obsidian's trash and is intended for internal plugin data management.
     * It's resilient and will not throw if the folder doesn't exist.
     * @param path The path of the folder to delete.
     */
    public async permanentlyDeleteFolder(path: string): Promise<void> {
        const adapter = this.vault.adapter;
        try {
            if (await adapter.exists(path)) {
                // The `true` flag enables recursive deletion.
                await adapter.rmdir(path, true);
            }
        } catch (error) {
            // Log the error but do not re-throw. The goal is to remove the folder;
            // if it fails, the system should log it but not crash.
            console.error(`VC: CRITICAL: Failed to permanently delete folder ${path}. Manual cleanup may be needed.`, error);
        }
    }
}