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

    private centralManifestWriteQueue: Promise<void> = Promise.resolve();

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

    async saveNoteManifest(manifest: NoteManifest): Promise<void> {
        const manifestPath = this.getNoteManifestPath(manifest.noteId);
        await this._atomicSaveManifest(manifestPath, manifest);
        this.noteManifestCache.set(manifest.noteId, manifest);
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
                    let needsRestore = false;
                    if (!await this.vault.adapter.exists(path)) {
                        needsRestore = true;
                    } else {
                        try {
                            const stats = await this.vault.adapter.stat(path);
                            if (stats?.size === 0) {
                                needsRestore = true;
                            }
                        } catch (statError) {
                            if (statError.code === 'ENOENT') {
                                // File was deleted between exists() and stat(), so it needs restore.
                                needsRestore = true;
                            } else {
                                // For other errors, log it but don't block the restore attempt.
                                console.warn(`VC: Could not stat file ${path} during restore check. Assuming it needs restore.`, statError);
                                needsRestore = true;
                            }
                        }
                    }

                    if (needsRestore) {
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
                .then(async () => {
                    const manifest = await this.loadCentralManifest(true); // Force reload
                    const { newManifest, result } = await task(manifest);
                    await this._atomicSaveManifest(CENTRAL_MANIFEST_PATH, newManifest);
                    
                    this.centralManifestCache = newManifest; // Update cache
                    this.rebuildPathToIdMap(); // Update map
                    
                    resolve(result);
                })
                .catch(err => {
                    console.error("VC: Error during queued central manifest operation.", err);
                    reject(err); 
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
            await this.saveNoteManifest(newNoteManifest);

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
        
        const noteManifest = await this.loadNoteManifest(noteId);
        if (noteManifest) {
            noteManifest.notePath = newPath;
            noteManifest.lastModified = now;
            await this.saveNoteManifest(noteManifest);
        } else {
            console.warn(`VC: Attempted to update path for non-existent note manifest: ${noteId}`);
        }

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
            await this._enqueueCentralManifestTask(async (manifest) => {
                if (manifest.notes[noteId]) {
                    delete manifest.notes[noteId];
                } else {
                    console.warn(`VC: deleteNoteEntry: Note ID ${noteId} not found in central manifest. No central update needed.`);
                }
                return { newManifest: manifest, result: undefined };
            });

            const noteDbPath = this.getNoteDbPath(noteId);
            if (await this.vault.adapter.exists(noteDbPath)) {
                try {
                    await this.vault.adapter.rmdir(noteDbPath, true);
                } catch (rmdirError) {
                    if (rmdirError.code === 'ENOENT') {
                        // This is okay. It means the directory was already deleted,
                        // which is the desired state. This can happen in race conditions.
                        console.log(`VC: Directory ${noteDbPath} was already gone during deletion. Ignoring ENOENT.`);
                    } else {
                        // A different error occurred (e.g., permissions), so we should re-throw it
                        // to be handled by the outer catch block.
                        throw rmdirError;
                    }
                }
            }
            this.invalidateNoteManifestCache(noteId);
            console.log(`VC: Successfully deleted note entry and data for ID ${noteId}.`);
        } catch (error) {
            console.error(`VC: Failed to delete note entry and data for ID ${noteId}`, error);
            throw new Error(`Failed to delete version history for a note. Some files may remain.`);
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
