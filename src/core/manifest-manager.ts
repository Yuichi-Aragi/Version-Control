import { App, Vault, normalizePath } from "obsidian";
import { CentralManifest, NoteManifest } from "../types";
import { DB_PATH } from "../constants";

const CENTRAL_MANIFEST_PATH = `${DB_PATH}/central-manifest.json`;

export class ManifestManager {
    private app: App;
    private vault: Vault;
    private centralManifestCache: CentralManifest | null = null;
    private noteManifestCache: Map<string, NoteManifest> = new Map();
    private pathToIdMap: Map<string, string> | null = null;

    private centralManifestWriteQueue: Promise<any> = Promise.resolve();
    private noteManifestWriteQueues = new Map<string, Promise<any>>();

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
                const initialManifest: CentralManifest = { version: "1.0.0", notes: {} };
                await this._atomicSaveManifest(CENTRAL_MANIFEST_PATH, initialManifest);
                this.centralManifestCache = initialManifest;
                this.rebuildPathToIdMap();
            } else {
                await this.loadCentralManifest(true);
            }
        } catch (error) {
            console.error("VC: CRITICAL: Failed to initialize database structure.", error);
            throw new Error("Could not initialize database. Check vault permissions and console.");
        }
    }

    async loadCentralManifest(forceReload = false): Promise<CentralManifest> {
        if (this.centralManifestCache && !forceReload) {
            return this.centralManifestCache;
        }
        const defaultManifest: CentralManifest = { version: "1.0.0", notes: {} };
        const loaded = await this._loadManifestFromFile<CentralManifest>(CENTRAL_MANIFEST_PATH, defaultManifest);
        
        this.centralManifestCache = (loaded && typeof loaded.notes === 'object') ? loaded : defaultManifest;
        
        this.rebuildPathToIdMap();
        return this.centralManifestCache;
    }

    public invalidateCentralManifestCache(): void {
        this.centralManifestCache = null;
        this.pathToIdMap = null;
        console.debug("VC: Central manifest cache invalidated.");
    }

    public async getNoteIdByPath(path: string): Promise<string | null> {
        if (!this.pathToIdMap || !this.centralManifestCache) {
            await this.loadCentralManifest(true);
        }
        return this.pathToIdMap?.get(path) ?? null;
    }

    private rebuildPathToIdMap(): void {
        if (!this.centralManifestCache || !this.centralManifestCache.notes) {
            this.pathToIdMap = new Map<string, string>();
            console.warn("VC: Central manifest cache or notes property is null/undefined during rebuildPathToIdMap. Initializing empty map.");
            return;
        }
        this.pathToIdMap = new Map<string, string>();
        for (const [noteId, noteData] of Object.entries(this.centralManifestCache.notes)) {
            if (noteData && noteData.notePath) {
                this.pathToIdMap.set(noteData.notePath, noteId);
            }
        }
    }

    async loadNoteManifest(noteId: string): Promise<NoteManifest | null> {
        if (this.noteManifestCache.has(noteId)) {
            return this.noteManifestCache.get(noteId) ?? null;
        }
        const manifestPath = this.getNoteManifestPath(noteId);
        const loaded = await this._loadManifestFromFile<NoteManifest>(manifestPath, null);
        if (loaded) {
            this.noteManifestCache.set(noteId, loaded);
        }
        return loaded;
    }

    /**
     * Atomically updates a note's manifest file by queueing the operation.
     * This method is the single, safe entry point for all note manifest modifications.
     * @param noteId The ID of the note whose manifest is to be updated.
     * @param updateFn A function that receives the current manifest, modifies it, and returns the updated version.
     * @returns A promise that resolves with the updated manifest.
     */
    public async updateNoteManifest(
        noteId: string,
        updateFn: (manifest: NoteManifest) => NoteManifest | Promise<NoteManifest>
    ): Promise<NoteManifest> {
        let updatedManifestResult: NoteManifest | null = null;

        const task = async () => {
            // Load the most recent version of the manifest inside the queued task
            const manifest = await this.loadNoteManifest(noteId);
            if (!manifest) {
                throw new Error(`Cannot update manifest for non-existent note ID: ${noteId}`);
            }

            // Apply the modifications from the provided function
            const updatedManifest = await Promise.resolve(updateFn(manifest));

            // Save the result atomically
            const manifestPath = this.getNoteManifestPath(noteId);
            await this._atomicSaveManifest(manifestPath, updatedManifest);
            
            // Update the cache with the newly saved manifest
            this.noteManifestCache.set(noteId, updatedManifest);
            updatedManifestResult = updatedManifest;
        };

        // Get the current promise chain for this noteId, or start a new one
        let queue = this.noteManifestWriteQueues.get(noteId) || Promise.resolve();

        // Add our task to the end of the chain
        const newQueuePromise = queue.then(task).catch(err => {
            console.error(`VC: Error during queued update of note manifest for ${noteId}.`, err);
            // Invalidate cache on error to force a fresh read next time
            this.invalidateNoteManifestCache(noteId);
            // Re-throw to ensure the original caller's promise is rejected
            throw err;
        });

        // Store the new promise chain
        this.noteManifestWriteQueues.set(noteId, newQueuePromise);

        // Wait for our specific task to complete
        await newQueuePromise;

        if (!updatedManifestResult) {
            // This should be unreachable if the promise resolves without error
            throw new Error("Update task completed but result was not captured.");
        }
        return updatedManifestResult;
    }
    
    public invalidateNoteManifestCache(noteId: string): void {
        this.noteManifestCache.delete(noteId);
    }

    private async _loadManifestFromFile<T>(path: string, defaultState: T | null): Promise<T | null> {
        const backupPath = `${path}.bak`;

        if (!await this.vault.adapter.exists(path) && await this.vault.adapter.exists(backupPath)) {
            console.warn(`VC: Main manifest ${path} not found, backup exists. Restoring from backup.`);
            try {
                await this.vault.adapter.rename(backupPath, path);
            } catch (restoreError) {
                console.error(`VC: CRITICAL: Could not restore manifest ${path} from backup ${backupPath}.`, restoreError);
                return defaultState;
            }
        }

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
                try {
                    await this.vault.adapter.copy(path, `${path}.corrupt.${Date.now()}`);
                } catch (backupError) {
                    console.error(`VC: Failed to backup corrupt manifest ${path}`, backupError);
                }
            }
            return defaultState;
        }
    }

    private async _atomicSaveManifest(path: string, data: any): Promise<void> {
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
            try {
                if (await this.vault.adapter.exists(backupPath)) {
                    // If the original path doesn't exist or is empty, restore from backup.
                    const originalExists = await this.vault.adapter.exists(path);
                    if (!originalExists || (await this.vault.adapter.stat(path))?.size === 0) {
                        if (originalExists) await this.vault.adapter.remove(path); // remove empty file
                        await this.vault.adapter.rename(backupPath, path);
                        console.log(`VC: Successfully restored manifest ${path} from backup after save failure.`);
                    }
                }
            } catch (restoreError) {
                console.error(`VC: CATASTROPHIC: Failed to restore ${path} from backup. Manual intervention needed. Backup: ${backupPath}.`, restoreError);
            }
            throw error;
        } finally {
            if (await this.vault.adapter.exists(tempPath)) {
                try {
                    await this.vault.adapter.remove(tempPath);
                } catch (cleanupError) {
                    console.warn(`VC: Failed to clean up temp manifest: ${tempPath}`, cleanupError);
                }
            }
        }
    }

    private _enqueueCentralManifestTask<T>(
        task: (manifest: CentralManifest) => Promise<{ newManifest: CentralManifest; result: T }>
    ): Promise<T> {
        const taskPromise = new Promise<T>((resolve, reject) => {
            this.centralManifestWriteQueue = this.centralManifestWriteQueue
                .then(async (previousManifest: CentralManifest | undefined) => {
                    // Use the manifest from the previous task in the queue if available, otherwise load fresh.
                    const manifest = previousManifest ?? await this.loadCentralManifest(true);
                    const { newManifest, result } = await task(manifest);
                    await this._atomicSaveManifest(CENTRAL_MANIFEST_PATH, newManifest);
                    
                    this.centralManifestCache = newManifest; // Update cache
                    this.rebuildPathToIdMap(); // Update map
                    
                    resolve(result);
                    return newManifest; // Pass the updated manifest to the next task in the chain
                })
                .catch(err => {
                    console.error("VC: Error during queued central manifest operation.", err);
                    this.invalidateCentralManifestCache(); // Invalidate on error to force reload next time
                    reject(err);
                    return undefined; // Ensure the chain continues with a clean slate
                });
        });
        return taskPromise;
    }

    async createNoteEntry(noteId: string, notePath: string): Promise<NoteManifest> {
        if (!noteId || !notePath) {
            throw new Error("VC: Invalid noteId or notePath for createNoteEntry.");
        }

        const noteDbPath = this.getNoteDbPath(noteId);
        const noteManifestPath = this.getNoteManifestPath(noteId);
        const versionsPath = `${noteDbPath}/versions`;

        try {
            if (!await this.vault.adapter.exists(noteDbPath)) {
                await this.vault.createFolder(noteDbPath);
            }
            if (!await this.vault.adapter.exists(versionsPath)) {
                await this.vault.createFolder(versionsPath);
            }

            const now = new Date().toISOString();
            const newNoteManifest: NoteManifest = {
                noteId, notePath, versions: {}, totalVersions: 0, createdAt: now, lastModified: now,
            };
            // Do an initial save without the queue, as this is a new entry.
            await this._atomicSaveManifest(this.getNoteManifestPath(noteId), newNoteManifest);
            this.noteManifestCache.set(noteId, newNoteManifest);


            await this._enqueueCentralManifestTask(async (centralManifest) => {
                centralManifest.notes[noteId] = {
                    notePath, manifestPath: noteManifestPath, createdAt: now, lastModified: now,
                };
                return { newManifest: centralManifest, result: undefined };
            });
            
            return newNoteManifest;

        } catch (error) {
            console.error(`VC: Failed to create new note entry for ID ${noteId}. Attempting rollback of filesystem changes.`, error);
            if (await this.vault.adapter.exists(noteDbPath)) {
                try {
                    await this.vault.adapter.rmdir(noteDbPath, true);
                    console.log(`VC: Successfully rolled back by deleting directory: ${noteDbPath}`);
                } catch (rmdirError) {
                    console.error(`VC: CRITICAL: Failed to rollback directory ${noteDbPath}. Manual cleanup may be needed.`, rmdirError);
                }
            }
            this.invalidateNoteManifestCache(noteId);
            throw error;
        }
    }

    async updateNotePath(noteId: string, newPath: string): Promise<void> {
        const now = new Date().toISOString();
        
        await this.updateNoteManifest(noteId, (manifest) => {
            manifest.notePath = newPath;
            manifest.lastModified = now;
            return manifest;
        }).catch(err => {
            // This can happen if the note manifest doesn't exist, which is a valid scenario.
            console.warn(`VC: Attempted to update path for non-existent note manifest: ${noteId}. Error: ${err.message}`);
        });

        await this._enqueueCentralManifestTask(async (manifest) => {
            if (manifest.notes[noteId]) {
                manifest.notes[noteId].notePath = newPath;
                manifest.notes[noteId].lastModified = now;
            } else {
                console.warn(`VC: Attempted to update path in central manifest for non-existent entry: ${noteId}`);
            }
            return { newManifest: manifest, result: undefined };
        });
    }

    async deleteNoteEntry(noteId: string): Promise<void> {
        try {
            // Step 1: Update the manifest first. This is the most critical atomic operation.
            // If this fails, we abort, and no data is lost.
            await this._enqueueCentralManifestTask(async (manifest) => {
                if (manifest.notes[noteId]) {
                    delete manifest.notes[noteId];
                } else {
                    console.warn(`VC: deleteNoteEntry: Note ID ${noteId} not found in central manifest. It might have been removed in a concurrent operation.`);
                }
                return { newManifest: manifest, result: undefined };
            });

            // Step 2: If manifest update was successful, delete the data directory.
            // If this fails, it's not critical. An orphan cleanup can find it later.
            const noteDbPath = this.getNoteDbPath(noteId);
            if (await this.vault.adapter.exists(noteDbPath)) {
                try {
                    await this.vault.adapter.rmdir(noteDbPath, true);
                } catch (rmdirError) {
                    if (rmdirError.code === 'ENOENT') {
                        console.log(`VC: Directory ${noteDbPath} was already gone during deletion. Ignoring ENOENT.`);
                    } else {
                        // Log this failure but don't throw, as the primary operation (manifest update) succeeded.
                        console.error(`VC: Failed to remove data directory ${noteDbPath} for deleted note ID ${noteId}. It can be cleaned up later by the orphan cleanup process.`, rmdirError);
                    }
                }
            }

            // Step 3: Invalidate caches.
            this.invalidateNoteManifestCache(noteId);
            this.noteManifestWriteQueues.delete(noteId); // Clear any pending queue for the deleted note
            // The central manifest cache is updated automatically by _enqueueCentralManifestTask
            console.log(`VC: Successfully deleted note entry and data for ID ${noteId}.`);

        } catch (error) {
            // This will catch errors from the manifest task, which is the critical failure point.
            console.error(`VC: Failed to complete deletion for note entry ID ${noteId}`, error);
            // Re-throw to let the caller (e.g., VersionManager) know it failed.
            throw new Error(`Failed to delete version history for a note. The operation may be incomplete.`);
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
