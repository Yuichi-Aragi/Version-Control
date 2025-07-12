import { App, Vault } from "obsidian";
import { injectable, inject } from 'inversify';
import { TYPES } from "../../types/inversify.types";

/**
 * Provides safe, atomic file I/O operations for JSON data,
 * handling temporary files and backups to prevent data corruption.
 */
@injectable()
export class AtomicFileIO {
    private vault: Vault;

    constructor(@inject(TYPES.App) app: App) {
        this.vault = app.vault;
    }

    /**
     * Atomically writes data to a JSON file.
     * It writes to a temporary file, creates a backup of the original,
     * renames the temp file to the original, and then deletes the backup.
     * @param path The destination file path.
     * @param data The data to serialize and write.
     */
    public async writeJsonFile(path: string, data: any): Promise<void> {
        const tempPath = `${path}.${Date.now()}.tmp`;
        const backupPath = `${path}.bak`;

        try {
            const content = JSON.stringify(data, null, 2);
            await this.vault.adapter.write(tempPath, content);

            if (await this.vault.adapter.exists(path)) {
                if (await this.vault.adapter.exists(backupPath)) {
                    await this.vault.adapter.remove(backupPath);
                }
                await this.vault.adapter.rename(path, backupPath);
            }

            await this.vault.adapter.rename(tempPath, path);

            if (await this.vault.adapter.exists(backupPath)) {
                await this.vault.adapter.remove(backupPath);
            }
        } catch (error) {
            console.error(`VC: CRITICAL: Failed to save manifest to ${path}. Attempting restore.`, error);
            await this.tryRestoreFromBackup(path, backupPath);
            throw error;
        } finally {
            await this.tryCleanupTempFile(tempPath);
        }
    }

    /**
     * Reads and parses a JSON file. If the main file is missing but a backup
     * exists, it attempts to restore from the backup first.
     * @param path The path of the file to read.
     * @param defaultState The default state to return if the file doesn't exist or is corrupt.
     * @returns The parsed data or the default state.
     */
    public async readJsonFile<T>(path: string, defaultState: T | null): Promise<T | null> {
        await this.tryRestoreFromBackupIfMainMissing(path, `${path}.bak`);

        try {
            if (!await this.vault.adapter.exists(path)) {
                return defaultState;
            }
            const content = await this.vault.adapter.read(path);
            if (!content || content.trim() === '') {
                console.warn(`VC: Manifest file ${path} is empty. Returning default.`);
                return defaultState;
            }
            return JSON.parse(content) as T;
        } catch (error) {
            console.error(`VC: Failed to load/parse manifest ${path}.`, error);
            if (error instanceof SyntaxError) {
                console.error(`VC: Manifest ${path} is corrupt! A backup of the corrupt file has been created.`);
                await this.tryBackupCorruptFile(path);
            }
            return defaultState;
        }
    }

    private async tryRestoreFromBackup(path: string, backupPath: string): Promise<void> {
        try {
            if (await this.vault.adapter.exists(backupPath)) {
                const originalExists = await this.vault.adapter.exists(path);
                if (!originalExists || (await this.vault.adapter.stat(path))?.size === 0) {
                    if (originalExists) await this.vault.adapter.remove(path);
                    await this.vault.adapter.rename(backupPath, path);
                }
            }
        } catch (restoreError) {
            console.error(`VC: CATASTROPHIC: Failed to restore ${path} from backup. Manual intervention needed. Backup: ${backupPath}.`, restoreError);
        }
    }

    private async tryRestoreFromBackupIfMainMissing(path: string, backupPath: string): Promise<void> {
        if (!await this.vault.adapter.exists(path) && await this.vault.adapter.exists(backupPath)) {
            console.warn(`VC: Main manifest ${path} not found, backup exists. Restoring from backup.`);
            try {
                await this.vault.adapter.rename(backupPath, path);
            } catch (restoreError) {
                console.error(`VC: CRITICAL: Could not restore manifest ${path} from backup ${backupPath}.`, restoreError);
            }
        }
    }

    private async tryBackupCorruptFile(path: string): Promise<void> {
        try {
            await this.vault.adapter.copy(path, `${path}.corrupt.${Date.now()}`);
        } catch (backupError) {
            console.error(`VC: Failed to backup corrupt manifest ${path}`, backupError);
        }
    }

    private async tryCleanupTempFile(tempPath: string): Promise<void> {
        if (await this.vault.adapter.exists(tempPath)) {
            try {
                await this.vault.adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn(`VC: Failed to clean up temp manifest: ${tempPath}`, cleanupError);
            }
        }
    }
}
