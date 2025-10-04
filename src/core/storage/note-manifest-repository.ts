import { injectable, inject } from 'inversify';
import { produce, type Draft } from 'immer';
import type { App } from 'obsidian';
import type { NoteManifest, Branch } from '../../types';
import { PathService } from './path-service';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import { DEFAULT_BRANCH_NAME } from '../../constants';

type V1NoteManifest = Omit<NoteManifest, 'branches' | 'currentBranch'> & {
    versions: { [versionId: string]: any };
    totalVersions: number;
    settings?: any;
};

/**
 * Repository for managing individual note manifest files.
 * Handles all CRUD operations and caching for a single note's version metadata.
 * This class encapsulates its own concurrency control for write operations.
 */
@injectable()
export class NoteManifestRepository {
    private readonly cache = new Map<string, NoteManifest>();
    private readonly writeLocks = new Map<string, Promise<void>>();

    constructor(
        @inject(TYPES.App) private readonly app: App,
        @inject(TYPES.PathService) private readonly pathService: PathService,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {
        // Defensive initialization
        if (!this.app?.vault?.adapter) {
            throw new Error('Invalid App instance: vault.adapter is required');
        }
        if (!this.pathService) {
            throw new Error('PathService is required');
        }
        if (!this.queueService) {
            throw new Error('QueueService is required');
        }
    }

    /**
     * Loads a note manifest from cache or disk, performing on-the-fly migration if necessary.
     * @param noteId - The unique identifier of the note
     * @param forceReload - Whether to bypass cache and reload from disk
     * @returns The note manifest or null if not found
     * @throws Error if noteId is invalid or system fails catastrophically
     */
    public async load(noteId: string, forceReload = false): Promise<NoteManifest | null> {
        // Strict input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId: must be a non-empty string');
        }

        const normalizedNoteId = noteId.trim();
        
        if (!forceReload && this.cache.has(normalizedNoteId)) {
            return this.cache.get(normalizedNoteId) ?? null;
        }

        try {
            let loaded = await this.readManifest(normalizedNoteId);

            // MIGRATION LOGIC: If the manifest is in the old format, migrate it.
            if (loaded && this.isV1Manifest(loaded)) {
                console.log(`VC: Migrating manifest for note ${normalizedNoteId} to branch structure.`);
                const migratedManifest = this.migrateV1Manifest(loaded as unknown as V1NoteManifest);
                // Persist the migrated structure immediately to complete the migration for this note.
                await this.writeManifestWithLock(normalizedNoteId, migratedManifest);
                loaded = migratedManifest;
            }

            if (loaded) {
                // Validate loaded manifest before caching
                this.validateManifest(loaded, normalizedNoteId);

                // Enforce data integrity for totalVersions on each branch
                for (const branchName in loaded.branches) {
                    const branch = loaded.branches[branchName];
                    if (branch) {
                        const actualCount = Object.keys(branch.versions || {}).length;
                        if (branch.totalVersions !== actualCount) {
                            console.warn(`VC: Correcting totalVersions for noteId ${normalizedNoteId}, branch ${branchName}. Stored: ${branch.totalVersions}, Actual: ${actualCount}.`);
                            branch.totalVersions = actualCount;
                        }
                    }
                }

                this.cache.set(normalizedNoteId, loaded);
            }
            return loaded;
        } catch (error) {
            console.error(`VC: Failed to load manifest for noteId: ${normalizedNoteId}`, error);
            throw error;
        }
    }

    /**
     * Creates a new note manifest.
     * @param noteId - The unique identifier of the note
     * @param notePath - The file path of the note
     * @returns The created note manifest
     * @throws Error if creation fails or inputs are invalid
     */
    public async create(noteId: string, notePath: string): Promise<NoteManifest> {
        // Strict input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId: must be a non-empty string');
        }
        if (typeof notePath !== 'string' || notePath.trim() === '') {
            throw new Error('Invalid notePath: must be a non-empty string');
        }

        const normalizedNoteId = noteId.trim();
        const normalizedNotePath = notePath.trim();

        // Check if manifest already exists
        const existing = await this.readManifest(normalizedNoteId);
        if (existing) {
            throw new Error(`Manifest already exists for noteId: ${normalizedNoteId}`);
        }

        // This operation is queued to prevent race conditions
        return this.queueService.enqueue(normalizedNoteId, async () => {
            // Double-check existence after acquiring queue lock
            const doubleCheck = await this.readManifest(normalizedNoteId);
            if (doubleCheck) {
                throw new Error(`Manifest already exists for noteId: ${normalizedNoteId} (race condition detected)`);
            }

            const now = new Date().toISOString();
            const newManifest: NoteManifest = {
                noteId: normalizedNoteId,
                notePath: normalizedNotePath,
                currentBranch: DEFAULT_BRANCH_NAME,
                branches: {
                    [DEFAULT_BRANCH_NAME]: {
                        versions: {},
                        totalVersions: 0,
                    }
                },
                createdAt: now,
                lastModified: now,
            };

            // Validate before writing
            this.validateManifest(newManifest, normalizedNoteId);

            try {
                await this.writeManifestWithLock(normalizedNoteId, newManifest);
                this.cache.set(normalizedNoteId, newManifest);
                return newManifest;
            } catch (error) {
                console.error(`VC: Failed to create manifest for noteId: ${normalizedNoteId}`, error);
                throw error;
            }
        });
    }

    /**
     * Updates a note manifest using a transformation function.
     * @param noteId - The unique identifier of the note
     * @param updateFn - Function that transforms the manifest draft
     * @param options - Update options
     * @returns The updated note manifest
     * @throws Error if update fails or inputs are invalid
     */
    public async update(
        noteId: string,
        updateFn: (draft: Draft<NoteManifest>) => void,
        options: { bypassQueue?: boolean } = {}
    ): Promise<NoteManifest> {
        // Strict input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId: must be a non-empty string');
        }
        if (typeof updateFn !== 'function') {
            throw new Error('Invalid updateFn: must be a function');
        }

        const normalizedNoteId = noteId.trim();
        const task = async (): Promise<NoteManifest> => {
            // Acquire write lock for this note
            const lockKey = `update-${normalizedNoteId}`;
            if (!this.writeLocks.has(lockKey)) {
                this.writeLocks.set(lockKey, Promise.resolve());
            }

            const currentLock = this.writeLocks.get(lockKey)!;
            let newLockResolve!: () => void;
            let newLockReject!: (reason?: any) => void;
            const newLock = new Promise<void>((resolve, reject) => {
                newLockResolve = resolve;
                newLockReject = reject;
            });

            this.writeLocks.set(lockKey, newLock);

            try {
                // Wait for previous operations to complete
                await currentLock;

                // 1. Read the most current state directly from disk
                const currentManifest = await this.readManifest(normalizedNoteId);
                if (!currentManifest) {
                    throw new Error(`Cannot update manifest for non-existent note ID: ${normalizedNoteId}`);
                }

                // Validate current manifest
                this.validateManifest(currentManifest, normalizedNoteId);

                // 2. Apply the synchronous transformation and enforce integrity
                const updatedManifest = produce(currentManifest, (draft) => {
                    try {
                        updateFn(draft);
                        // Enforce integrity after the update function has run
                        const currentBranch = draft.branches[draft.currentBranch];
                        if (currentBranch) {
                            currentBranch.totalVersions = Object.keys(currentBranch.versions || {}).length;
                        }
                    } catch (error) {
                        console.error(`VC: Update function failed for noteId: ${normalizedNoteId}`, error);
                        throw new Error(`Update function failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                });

                // 3. Validate the updated manifest
                this.validateManifest(updatedManifest, normalizedNoteId);

                // 4. Write the new state back to disk
                await this.writeManifestWithLock(normalizedNoteId, updatedManifest);

                // 5. Update the in-memory cache only after the write is successful
                this.cache.set(normalizedNoteId, updatedManifest);
                return updatedManifest;
            } catch (error) {
                newLockReject(error);
                throw error;
            } finally {
                newLockResolve();
                // Clean up lock if no other operations are pending
                setTimeout(() => {
                    if (this.writeLocks.get(lockKey) === newLock) {
                        this.writeLocks.delete(lockKey);
                    }
                }, 0);
            }
        };

        if (options.bypassQueue) {
            return task();
        }
        
        return this.queueService.enqueue(normalizedNoteId, task);
    }

    /**
     * Invalidates cache for a specific note and clears its queue.
     * @param noteId - The unique identifier of the note
     */
    public invalidateCache(noteId: string): void {
        if (typeof noteId !== 'string') {
            console.warn('VC: Attempted to invalidate cache with invalid noteId');
            return;
        }

        const normalizedNoteId = noteId.trim();
        this.cache.delete(normalizedNoteId);
        this.queueService.clear(normalizedNoteId);
        
        // Clean up any remaining write locks
        const lockKey = `update-${normalizedNoteId}`;
        if (this.writeLocks.has(lockKey)) {
            this.writeLocks.delete(lockKey);
        }
    }

    /**
     * Clears the entire in-memory cache of note manifests.
     * This is typically used during plugin unload.
     */
    public clearCache(): void {
        this.cache.clear();
        // Don't clear writeLocks as they're note-specific and should be cleaned up individually
    }

    /**
     * Reads a manifest from disk with comprehensive error handling.
     * @param noteId - The unique identifier of the note
     * @returns The note manifest or null if not found or invalid
     */
    private async readManifest(noteId: string): Promise<NoteManifest | null> {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId in readManifest');
        }

        const normalizedNoteId = noteId.trim();
        const manifestPath = this.pathService.getNoteManifestPath(normalizedNoteId);

        try {
            // Validate path
            if (!manifestPath || typeof manifestPath !== 'string' || manifestPath.trim() === '') {
                throw new Error('Invalid manifest path returned from PathService');
            }

            const exists = await this.app.vault.adapter.exists(manifestPath);
            if (!exists) {
                return null;
            }

            const content = await this.app.vault.adapter.read(manifestPath);
            
            if (!content || typeof content !== 'string') {
                console.warn(`VC: Manifest file ${manifestPath} has invalid content type. Returning null.`);
                return null;
            }

            if (content.trim() === '') {
                console.warn(`VC: Manifest file ${manifestPath} is empty. Returning null.`);
                return null;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(content);
            } catch (parseError) {
                console.error(`VC: Failed to parse JSON in manifest ${manifestPath}.`, parseError);
                if (parseError instanceof SyntaxError) {
                    console.error(`VC: Manifest ${manifestPath} is corrupt! A backup of the corrupt file has been created.`);
                    await this.tryBackupCorruptFile(manifestPath);
                }
                return null;
            }

            // Return the parsed object. Validation and migration will happen in the `load` method.
            return parsed as NoteManifest;
        } catch (error) {
            console.error(`VC: Failed to load/parse manifest ${manifestPath}.`, error);
            return null;
        }
    }

    /**
     * Writes a manifest to disk with additional locking mechanism.
     * @param noteId - The unique identifier of the note
     * @param data - The manifest data to write
     */
    private async writeManifestWithLock(noteId: string, data: NoteManifest): Promise<void> {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Invalid noteId in writeManifestWithLock');
        }

        const normalizedNoteId = noteId.trim();
        const manifestPath = this.pathService.getNoteManifestPath(normalizedNoteId);

        // Validate path
        if (!manifestPath || typeof manifestPath !== 'string' || manifestPath.trim() === '') {
            throw new Error('Invalid manifest path returned from PathService');
        }

        // Validate data before writing
        this.validateManifest(data, normalizedNoteId);

        const lockKey = `write-${normalizedNoteId}`;
        if (!this.writeLocks.has(lockKey)) {
            this.writeLocks.set(lockKey, Promise.resolve());
        }

        const currentLock = this.writeLocks.get(lockKey)!;
        let newLockResolve!: () => void;
        let newLockReject!: (reason?: any) => void;
        const newLock = new Promise<void>((resolve, reject) => {
            newLockResolve = resolve;
            newLockReject = reject;
        });

        this.writeLocks.set(lockKey, newLock);

        try {
            // Wait for previous write operations to complete
            await currentLock;

            const content = JSON.stringify(data, null, 2);
            
            // Ensure content is valid JSON before writing
            try {
                JSON.parse(content);
            } catch (jsonError) {
                throw new Error(`Generated JSON content is invalid: ${jsonError}`);
            }

            await this.app.vault.adapter.write(manifestPath, content);
        } catch (error) {
            newLockReject(error);
            console.error(`VC: CRITICAL: Failed to save manifest to ${manifestPath}.`, error);
            throw error;
        } finally {
            newLockResolve();
            // Clean up lock if no other operations are pending
            setTimeout(() => {
                if (this.writeLocks.get(lockKey) === newLock) {
                    this.writeLocks.delete(lockKey);
                }
            }, 0);
        }
    }

    /**
     * Attempts to backup a corrupt manifest file.
     * @param path - The path of the corrupt file
     */
    private async tryBackupCorruptFile(path: string): Promise<void> {
        if (typeof path !== 'string' || path.trim() === '') {
            console.error('VC: Invalid path for backup operation');
            return;
        }

        const normalizedPath = path.trim();
        const backupPath = `${normalizedPath}.corrupt.${Date.now()}`;

        try {
            await this.app.vault.adapter.copy(normalizedPath, backupPath);
            console.log(`VC: Successfully backed up corrupt manifest to ${backupPath}`);
        } catch (backupError) {
            console.error(`VC: Failed to backup corrupt manifest ${normalizedPath}`, backupError);
            // Don't throw - this is a recovery operation
        }
    }

    private isV1Manifest(obj: any): obj is V1NoteManifest {
        return obj && typeof obj === 'object' && obj.versions && !obj.branches;
    }
    
    private migrateV1Manifest(v1Manifest: V1NoteManifest): NoteManifest {
        const mainBranch: Branch = {
            versions: v1Manifest.versions,
            totalVersions: v1Manifest.totalVersions,
            settings: v1Manifest.settings,
        };
    
        const newManifest: NoteManifest = {
            noteId: v1Manifest.noteId,
            notePath: v1Manifest.notePath,
            createdAt: v1Manifest.createdAt,
            lastModified: v1Manifest.lastModified,
            currentBranch: DEFAULT_BRANCH_NAME,
            branches: {
                [DEFAULT_BRANCH_NAME]: mainBranch,
            },
        };
        return newManifest;
    }

    /**
     * Validates that a manifest object has the correct structure and data.
     * @param manifest - The manifest to validate
     * @param expectedNoteId - The expected note ID
     * @throws Error if validation fails
     */
    private validateManifest(manifest: NoteManifest, expectedNoteId: string): void {
        if (!this.isValidNoteManifest(manifest, expectedNoteId)) {
            throw new Error(`Invalid manifest structure for noteId: ${expectedNoteId}`);
        }

        // Additional validation for date fields
        if (!this.isValidISODate(manifest.createdAt)) {
            throw new Error(`Invalid createdAt date format: ${manifest.createdAt}`);
        }
        if (!this.isValidISODate(manifest.lastModified)) {
            throw new Error(`Invalid lastModified date format: ${manifest.lastModified}`);
        }

        // Validate that lastModified is not before createdAt
        if (new Date(manifest.lastModified) < new Date(manifest.createdAt)) {
            throw new Error(`lastModified (${manifest.lastModified}) cannot be before createdAt (${manifest.createdAt})`);
        }

        // Validate totalVersions matches actual versions count for each branch
        for (const branchName in manifest.branches) {
            const branch = manifest.branches[branchName];
            if (branch) {
                const actualVersionsCount = Object.keys(branch.versions || {}).length;
                if (branch.totalVersions !== actualVersionsCount) {
                    console.warn(`VC: totalVersions mismatch detected for branch "${branchName}" (${branch.totalVersions} vs ${actualVersionsCount}) for noteId: ${expectedNoteId}. This will be auto-corrected on next update.`);
                }
            }
        }
    }

    /**
     * Checks if an object is a valid NoteManifest.
     * @param obj - The object to validate
     * @param expectedNoteId - The expected note ID
     * @returns true if valid, false otherwise
     */
    private isValidNoteManifest(obj: unknown, expectedNoteId: string): obj is NoteManifest {
        if (!obj || typeof obj !== 'object') {
            return false;
        }

        const manifest = obj as NoteManifest;
        
        // Required fields
        if (typeof manifest.noteId !== 'string' || manifest.noteId !== expectedNoteId) {
            return false;
        }
        if (typeof manifest.notePath !== 'string' || manifest.notePath.trim() === '') {
            return false;
        }
        if (typeof manifest.createdAt !== 'string' || !this.isValidISODate(manifest.createdAt)) {
            return false;
        }
        if (typeof manifest.lastModified !== 'string' || !this.isValidISODate(manifest.lastModified)) {
            return false;
        }
        if (typeof manifest.currentBranch !== 'string' || manifest.currentBranch.trim() === '') {
            return false;
        }
        if (manifest.branches === null || typeof manifest.branches !== 'object') {
            return false;
        }
        if (!manifest.branches[manifest.currentBranch]) {
            return false; // currentBranch must exist in branches
        }

        for (const branchName in manifest.branches) {
            const branch = manifest.branches[branchName];
            if (!branch || typeof branch !== 'object') return false;
            if (typeof branch.totalVersions !== 'number' || !Number.isInteger(branch.totalVersions) || branch.totalVersions < 0) {
                return false;
            }
            if (branch.versions !== undefined && (branch.versions === null || typeof branch.versions !== 'object')) {
                return false;
            }
            if (branch.versions) {
                for (const [key, value] of Object.entries(branch.versions)) {
                    if (typeof key !== 'string' || !key.trim()) return false;
                    if (!value || typeof value !== 'object') return false;
                }
            }
        }

        return true;
    }

    /**
     * Validates if a string is a valid ISO date string.
     * @param dateString - The string to validate
     * @returns true if valid, false otherwise
     */
    private isValidISODate(dateString: string): boolean {
        if (typeof dateString !== 'string') {
            return false;
        }
        
        const date = new Date(dateString);
        return !isNaN(date.getTime()) && date.toISOString() === dateString;
    }
}
