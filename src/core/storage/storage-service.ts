import { App, TFolder, Vault } from "obsidian";
import { injectable, inject } from 'inversify';
import { TYPES } from '@/types/inversify.types';

/**
 * A low-level service for direct, robust interactions with the vault's file system adapter.
 * It encapsulates common, potentially risky file operations like recursive deletion and
 * folder creation, providing a centralized and resilient implementation with
 * built-in retry logic and false-positive error mitigation.
 * 
 * ENHANCEMENT: Absolute idempotency guarantees for all operations.
 */
@injectable()
export class StorageService {
    private vault: Vault;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_MS = 100;

    constructor(@inject(TYPES.App) app: App) {
        this.vault = app.vault;
    }

    /**
     * Ensures a folder exists at the specified path. If it doesn't, it's created.
     * Throws an error if a file exists at the path instead of a folder.
     * Includes retry logic and race condition handling.
     * @param path The full path of the folder to ensure existence of.
     */
    public async ensureFolderExists(path: string): Promise<void> {
        await this.executeWithRetry(
            async () => {
                // 1. Check Obsidian Cache (Fast check)
                const item = this.vault.getAbstractFileByPath(path);
                if (item) {
                    if (item instanceof TFolder) {
                        return; // Success
                    } else {
                        throw new Error(`A file exists at the required folder path "${path}".`);
                    }
                }

                // 2. Attempt Creation
                try {
                    await this.vault.createFolder(path);
                } catch (error) {
                    // Handle race condition where folder was created between check and create
                    // or exists on disk but not in cache yet.
                    if (error instanceof Error && error.message.includes('Folder already exists')) {
                        // Verify it is actually a folder on disk using Adapter
                        const stat = await this.vault.adapter.stat(path);
                        if (stat?.type === 'folder') {
                            return; // Success
                        }
                        if (stat?.type === 'file') {
                            throw new Error(`A file exists at the required folder path "${path}".`);
                        }
                        // If stat is null here, it means it DOESN'T exist, so the error was weird.
                        // We throw to retry.
                    }
                    throw error;
                }
            },
            async () => {
                // Validation: Check if folder exists now using Adapter (Source of Truth)
                // This bypasses potential cache lag in getAbstractFileByPath
                const stat = await this.vault.adapter.stat(path);
                return stat?.type === 'folder';
            },
            `ensureFolderExists:${path}`
        );
    }

    /**
     * Permanently and recursively deletes a folder using the vault adapter.
     * This bypasses Obsidian's trash and is intended for internal plugin data management.
     * It's resilient and will not throw if the folder doesn't exist (Idempotent).
     * @param path The path of the folder to delete.
     */
    public async permanentlyDeleteFolder(path: string): Promise<void> {
        await this.executeWithRetry(
            async () => {
                const exists = await this.vault.adapter.exists(path);
                if (exists) {
                    try {
                        await this.vault.adapter.rmdir(path, true);
                    } catch (error) {
                        // If it fails because it's already gone (race condition), ignore.
                        const stillExists = await this.vault.adapter.exists(path);
                        if (!stillExists) return;
                        throw error;
                    }
                }
            },
            async () => {
                // Validation: Check if folder is gone
                const exists = await this.vault.adapter.exists(path);
                return !exists;
            },
            `permanentlyDeleteFolder:${path}`
        );
    }

    /**
     * Renames a folder from an old path to a new path.
     * Includes robust idempotency checks and false-positive error mitigation for race conditions.
     * @param oldPath The current path of the folder.
     * @param newPath The desired new path for the folder.
     * @throws Error if the old folder doesn't exist or the new path is occupied (and not by the renamed folder).
     */
    public async renameFolder(oldPath: string, newPath: string): Promise<void> {
        await this.executeWithRetry(
            async () => {
                // Pre-flight checks
                const sourceExists = await this.vault.adapter.exists(oldPath);
                const targetExists = await this.vault.adapter.exists(newPath);

                if (!sourceExists) {
                    if (targetExists) {
                        // Assume success from previous attempt/race
                        return;
                    }
                    throw new Error(`Source folder "${oldPath}" does not exist.`);
                }

                if (targetExists) {
                    throw new Error(`Destination path "${newPath}" already exists.`);
                }

                try {
                    await this.vault.adapter.rename(oldPath, newPath);
                } catch (error) {
                    // Check for race condition success
                    const s = await this.vault.adapter.exists(oldPath);
                    const t = await this.vault.adapter.exists(newPath);
                    if (!s && t) return; // Success happened despite error
                    throw error;
                }
            },
            async () => {
                // Validation: Source should be gone, Target should exist
                const sourceExists = await this.vault.adapter.exists(oldPath);
                const targetExists = await this.vault.adapter.exists(newPath);
                return !sourceExists && targetExists;
            },
            `renameFolder:${oldPath}->${newPath}`
        );
    }

    /**
     * Executes a file system operation with retries and false-positive mitigation.
     * @param operation The async operation to perform.
     * @param validation A function that returns true if the desired state is reached (mitigates false positive errors).
     * @param contextDescription Description for logging.
     */
    private async executeWithRetry(
        operation: () => Promise<void>,
        validation: () => Promise<boolean>,
        contextDescription: string
    ): Promise<void> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                await operation();
                return; // Success
            } catch (error) {
                lastError = error;
                
                // Immediate validation check for false positives (e.g. race conditions where op succeeded but threw)
                try {
                    if (await validation()) {
                        return; // Desired state reached despite error
                    }
                } catch (valError) {
                    // Validation failed, ignore and proceed to retry logic
                }

                if (attempt < this.MAX_RETRIES) {
                    // Wait with exponential backoff before retrying
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * attempt));
                }
            }
        }

        // Final validation check before giving up
        if (await validation()) {
            return;
        }

        console.error(`VC: StorageService operation failed after ${this.MAX_RETRIES} attempts: ${contextDescription}`, lastError);
        throw lastError;
    }
}
