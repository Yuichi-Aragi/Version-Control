import { App, Vault, normalizePath, Notice } from "obsidian";
import { CentralManifest, NoteManifest } from "../types";
import { DB_PATH } from "../constants";

const CENTRAL_MANIFEST_PATH = `${DB_PATH}/central-manifest.json`;

export class ManifestManager {
    private app: App;
    private vault: Vault;

    constructor(app: App) {
        this.app = app;
        this.vault = app.vault;
    }

    async initializeDatabase(): Promise<void> {
        try {
            if (!await this.vault.adapter.exists(DB_PATH)) {
                await this.vault.createFolder(DB_PATH);
            }

            const dbSubFolder = `${DB_PATH}/db`;
            if (!await this.vault.adapter.exists(dbSubFolder)) {
                await this.vault.createFolder(dbSubFolder);
            }

            if (!await this.vault.adapter.exists(CENTRAL_MANIFEST_PATH)) {
                const initialManifest: CentralManifest = {
                    version: "1.0.0",
                    notes: {},
                };
                await this.saveCentralManifest(initialManifest);
            }
        } catch (error) {
            console.error("Version Control: CRITICAL: Failed to initialize database.", error);
            new Notice("Version Control: Could not initialize database. Check permissions and console for details.");
            throw error; // Re-throw to signal catastrophic failure
        }
    }

    async loadCentralManifest(): Promise<CentralManifest | null> {
        return this.loadManifest<CentralManifest>(CENTRAL_MANIFEST_PATH, { version: "1.0.0", notes: {} });
    }

    async saveCentralManifest(manifest: CentralManifest): Promise<void> {
        await this.saveManifest(CENTRAL_MANIFEST_PATH, manifest);
    }

    async loadNoteManifest(noteId: string): Promise<NoteManifest | null> {
        const manifestPath = this.getNoteManifestPath(noteId);
        return this.loadManifest<NoteManifest>(manifestPath, null);
    }

    async saveNoteManifest(manifest: NoteManifest): Promise<void> {
        const manifestPath = this.getNoteManifestPath(manifest.noteId);
        await this.saveManifest(manifestPath, manifest);
    }

    private async loadManifest<T>(path: string, defaultState: T | null): Promise<T | null> {
        const backupPath = `${path}.bak`;

        // --- Recovery Check ---
        // If the main file is missing but a backup exists, a crash likely occurred during a save.
        // Restore the backup before proceeding.
        if (!await this.vault.adapter.exists(path) && await this.vault.adapter.exists(backupPath)) {
            console.warn(`Version Control: Main manifest ${path} not found, but backup exists. Restoring from backup.`);
            try {
                await this.vault.adapter.rename(backupPath, path);
                new Notice(`Version Control: Recovered a manifest file.`, 5000);
            } catch (restoreError) {
                console.error(`Version Control: CRITICAL: Could not restore manifest from backup ${backupPath}.`, restoreError);
                new Notice(`CRITICAL: Could not restore manifest from backup. Check console.`);
                return defaultState; // Cannot proceed.
            }
        }

        // --- Normal Load Logic ---
        try {
            if (!await this.vault.adapter.exists(path)) {
                return defaultState;
            }
            const content = await this.vault.adapter.read(path);
            if (!content || content.trim() === '') {
                console.warn(`Version Control: Manifest at ${path} is empty. Returning default state.`);
                return defaultState;
            }
            return JSON.parse(content) as T;
        } catch (error) {
            console.error(`Version Control: Failed to load or parse manifest at ${path}.`, error);
            if (error instanceof SyntaxError) {
                new Notice(`Version Control: Manifest file at ${path} is corrupt. A backup of the corrupt file has been created for inspection.`, 10000);
                try {
                    await this.vault.adapter.copy(path, `${path}.corrupt.${Date.now()}`);
                } catch (backupError) {
                    console.error(`Version Control: Failed to create backup of corrupt manifest ${path}`, backupError);
                }
            }
            return defaultState; // Return default state on error to prevent crashes
        }
    }

    /**
     * Atomically saves a manifest file using a temporary file and a backup.
     * This prevents data corruption if the app crashes during a write operation.
     * @param path The final path of the manifest file.
     * @param data The data to save.
     */
    private async saveManifest(path: string, data: any): Promise<void> {
        const tempPath = `${path}.${Date.now()}.tmp`;
        const backupPath = `${path}.bak`;

        try {
            // 1. Write the new data to a temporary file.
            const content = JSON.stringify(data, null, 2);
            await this.vault.adapter.write(tempPath, content);

            // 2. Rename the current manifest to a backup. This is atomic.
            //    If the manifest doesn't exist yet, this step is skipped.
            if (await this.vault.adapter.exists(path)) {
                await this.vault.adapter.rename(path, backupPath);
            }

            // 3. Rename the temporary file to the final manifest path. This is atomic.
            //    Since we just renamed the original `path` away, this should never fail with "file exists".
            await this.vault.adapter.rename(tempPath, path);

            // 4. If we get here, the new manifest is safely in place. We can remove the backup.
            if (await this.vault.adapter.exists(backupPath)) {
                await this.vault.adapter.remove(backupPath);
            }
        } catch (error) {
            console.error(`Version Control: CRITICAL: Failed to save manifest to ${path}. Attempting to restore from backup.`, error);
            new Notice(`Version Control: Error saving manifest for ${path}. Check console.`);

            // --- Automatic Recovery on Failure ---
            try {
                // If the save failed, the primary `path` might not exist.
                // Try to restore the backup file if it exists.
                if (await this.vault.adapter.exists(backupPath) && !await this.vault.adapter.exists(path)) {
                    await this.vault.adapter.rename(backupPath, path);
                    console.log(`Version Control: Successfully restored manifest ${path} from backup.`);
                }
            } catch (restoreError) {
                console.error(`Version Control: CATASTROPHIC: Failed to restore manifest ${path} from backup. Manual intervention may be required. The backup file is at ${backupPath}.`, restoreError);
                new Notice(`CRITICAL: Failed to restore manifest from backup. Please check your .versiondb folder.`);
            }

            // Re-throw the original error so the calling function knows the save failed.
            throw error;
        } finally {
            // --- Final Cleanup ---
            // Always try to remove the temp file, as it's either been renamed or is no longer needed.
            if (await this.vault.adapter.exists(tempPath)) {
                try {
                    await this.vault.adapter.remove(tempPath);
                } catch (cleanupError) {
                    // This is not critical, but good to log.
                    console.warn(`Version Control: Failed to clean up temporary manifest file: ${tempPath}`, cleanupError);
                }
            }
        }
    }

    async createNoteEntry(noteId: string, notePath: string): Promise<NoteManifest> {
        if (!noteId || !notePath) {
            const error = new Error("Invalid noteId or notePath provided for creating a note entry.");
            console.error("Version Control: " + error.message, { noteId, notePath });
            throw error;
        }
        try {
            const noteDbPath = this.getNoteDbPath(noteId);
            
            if (!await this.vault.adapter.exists(noteDbPath)) {
                await this.vault.createFolder(noteDbPath);
            }
            const versionsPath = `${noteDbPath}/versions`;
            if (!await this.vault.adapter.exists(versionsPath)) {
                await this.vault.createFolder(versionsPath);
            }

            const now = new Date().toISOString();
            const newManifest: NoteManifest = {
                noteId,
                notePath,
                versions: {},
                totalVersions: 0,
                createdAt: now,
                lastModified: now,
            };
            await this.saveNoteManifest(newManifest);

            const centralManifest = await this.loadCentralManifest();
            if (centralManifest) {
                centralManifest.notes[noteId] = {
                    notePath,
                    manifestPath: this.getNoteManifestPath(noteId),
                    createdAt: now,
                    lastModified: now,
                };
                await this.saveCentralManifest(centralManifest);
            } else {
                throw new Error("Could not load central manifest to create new note entry.");
            }
            return newManifest;
        } catch (error) {
            console.error(`Version Control: Failed to create new note entry for ID ${noteId}`, error);
            new Notice("Version Control: Failed to create version control entry for this note.");
            throw error;
        }
    }

    async updateNotePath(noteId: string, newPath: string): Promise<void> {
        // To maintain data consistency, we update the more specific note manifest first.
        // If this fails, the central manifest (the "index") remains correct.
        const noteManifest = await this.loadNoteManifest(noteId);
        if (noteManifest) {
            noteManifest.notePath = newPath;
            noteManifest.lastModified = new Date().toISOString();
            await this.saveNoteManifest(noteManifest);
        }

        // Only update the central manifest if the note-specific one was updated successfully.
        const centralManifest = await this.loadCentralManifest();
        if (centralManifest && centralManifest.notes[noteId]) {
            centralManifest.notes[noteId].notePath = newPath;
            centralManifest.notes[noteId].lastModified = new Date().toISOString();
            await this.saveCentralManifest(centralManifest);
        }
    }

    async deleteNoteEntry(noteId: string): Promise<void> {
        try {
            const centralManifest = await this.loadCentralManifest();
            if (centralManifest && centralManifest.notes[noteId]) {
                delete centralManifest.notes[noteId];
                await this.saveCentralManifest(centralManifest);
            }

            const noteDbPath = this.getNoteDbPath(noteId);
            if (await this.vault.adapter.exists(noteDbPath)) {
                await this.vault.adapter.rmdir(noteDbPath, true);
            }
        } catch (error) {
            console.error(`Version Control: Failed to delete note entry for ID ${noteId}`, error);
            new Notice("Version Control: Error deleting version history. Some files may remain.");
        }
    }

    getNoteDbPath(noteId: string): string {
        return normalizePath(`${DB_PATH}/db/${noteId}`);
    }

    getNoteManifestPath(noteId: string): string {
        return normalizePath(`${this.getNoteDbPath(noteId)}/manifest.json`);
    }

    getNoteVersionPath(noteId: string, versionId: string): string {
        return normalizePath(`${this.getNoteDbPath(noteId)}/versions/${versionId}.md`);
    }
}