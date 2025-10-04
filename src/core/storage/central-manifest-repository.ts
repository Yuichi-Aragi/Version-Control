import { injectable, inject } from 'inversify';
import { produce } from 'immer';
import type { CentralManifest, NoteEntry } from '../../types';
import { TYPES } from '../../types/inversify.types';
import { QueueService } from '../../services/queue-service';
import type VersionControlPlugin from '../../main';

const CENTRAL_MANIFEST_QUEUE_KEY = 'system:central-manifest';

/**
 * Repository for managing the central manifest, which is now stored in the
 * plugin's main settings file (data.json).
 * Handles all update operations and caching for the list of versioned notes.
 * It interacts with the plugin's settings object and triggers saves.
 * 
 * Enterprise-grade implementation with strict defensive programming, type safety,
 * error tolerance, and resilience against edge cases.
 */
@injectable()
export class CentralManifestRepository {
    private cache: CentralManifest | null = null;
    private pathToIdMap: Map<string, string> | null = null;
    private isInitializing: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor(
        @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {
        // Defensive initialization guard
        if (!plugin) {
            throw new Error('CentralManifestRepository: Plugin dependency is required');
        }
        if (!queueService) {
            throw new Error('CentralManifestRepository: QueueService dependency is required');
        }
    }

    /**
     * Loads the central manifest with comprehensive validation and error handling.
     * @param forceReload - Forces reloading from persistent storage
     * @returns Promise resolving to the validated CentralManifest
     */
    public async load(forceReload: boolean = false): Promise<CentralManifest> {
        try {
            // Validate input
            if (typeof forceReload !== 'boolean') {
                throw new TypeError('forceReload must be a boolean');
            }

            // Return cached data if available and reload not forced
            if (this.cache && !forceReload) {
                return { ...this.cache }; // Return defensive copy
            }

            // Prevent concurrent initialization
            if (this.isInitializing && !forceReload) {
                if (this.initializationPromise) {
                    await this.initializationPromise;
                }
                if (this.cache) {
                    return { ...this.cache };
                }
            }

            // Set initialization state
            if (!this.isInitializing) {
                this.isInitializing = true;
                this.initializationPromise = this.initializeManifest();
            }

            await this.initializationPromise;

            // Final validation before returning
            if (!this.cache) {
                throw new Error('Failed to initialize central manifest');
            }

            return { ...this.cache }; // Return defensive copy
        } catch (error) {
            console.error('CentralManifestRepository.load failed:', error);
            // Return safe default on error
            const safeDefault = this.createDefaultManifest();
            this.cache = safeDefault;
            this.rebuildPathToIdMap();
            return { ...safeDefault };
        }
    }

    /**
     * Internal method to initialize the manifest with comprehensive validation.
     * This method is mutation-safe and does not modify the settings object directly.
     */
    private async initializeManifest(): Promise<void> {
        try {
            if (!this.plugin || !this.plugin.settings) {
                throw new Error('Plugin or settings not properly initialized');
            }
    
            const originalManifest = this.plugin.settings.centralManifest;
            let needsSave = false;
    
            // Create a new manifest object, starting with a default structure.
            const sanitizedManifest: CentralManifest = this.createDefaultManifest();
    
            if (originalManifest && typeof originalManifest === 'object' && !Array.isArray(originalManifest)) {
                // If an original manifest exists, populate the new one from it, sanitizing as we go.
                sanitizedManifest.version = (typeof originalManifest.version === 'string' && originalManifest.version) ? originalManifest.version : '1.0.0';
                
                if (originalManifest.notes && typeof originalManifest.notes === 'object' && !Array.isArray(originalManifest.notes)) {
                    sanitizedManifest.notes = this.sanitizeNotes(originalManifest.notes);
                }
            }
            
            // Check if the sanitization process resulted in any changes.
            if (JSON.stringify(originalManifest) !== JSON.stringify(sanitizedManifest)) {
                needsSave = true;
            }
    
            if (needsSave) {
                this.plugin.settings.centralManifest = sanitizedManifest;
                try {
                    await this.plugin.saveSettings();
                } catch (saveError) {
                    console.warn('Failed to save sanitized manifest:', saveError);
                }
            }
    
            // Set cache and rebuild map using the sanitized version.
            this.cache = { ...sanitizedManifest }; // Defensive copy
            this.rebuildPathToIdMap();
    
        } catch (error) {
            console.error('initializeManifest failed:', error);
            // Fallback to default manifest
            this.cache = this.createDefaultManifest();
            this.rebuildPathToIdMap();
        } finally {
            this.isInitializing = false;
            this.initializationPromise = null;
        }
    }

    /**
     * Creates a default manifest structure
     */
    private createDefaultManifest(): CentralManifest {
        return {
            version: '1.0.0',
            notes: {}
        };
    }

    /**
     * Sanitizes notes object, removing invalid entries
     */
    private sanitizeNotes(notes: Record<string, any>): Record<string, NoteEntry> {
        const sanitized: Record<string, NoteEntry> = {};
        
        if (!notes || typeof notes !== 'object') {
            return sanitized;
        }

        for (const [noteId, noteData] of Object.entries(notes)) {
            try {
                // Validate noteId
                if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
                    continue;
                }

                // Validate noteData
                if (!noteData || typeof noteData !== 'object' || Array.isArray(noteData)) {
                    continue;
                }

                // Validate required fields
                if (!noteData.notePath || typeof noteData.notePath !== 'string') {
                    continue;
                }

                if (!noteData.manifestPath || typeof noteData.manifestPath !== 'string') {
                    continue;
                }

                // Validate and sanitize dates
                let createdAt = noteData.createdAt;
                let lastModified = noteData.lastModified;

                if (!createdAt || typeof createdAt !== 'string') {
                    createdAt = new Date().toISOString();
                }

                if (!lastModified || typeof lastModified !== 'string') {
                    lastModified = createdAt;
                }

                // Validate date format
                if (isNaN(new Date(createdAt).getTime())) {
                    createdAt = new Date().toISOString();
                }

                if (isNaN(new Date(lastModified).getTime())) {
                    lastModified = createdAt;
                }

                sanitized[noteId] = {
                    notePath: noteData.notePath,
                    manifestPath: noteData.manifestPath,
                    createdAt,
                    lastModified
                };
            } catch (error) {
                console.warn(`Failed to sanitize note entry ${noteId}:`, error);
                continue;
            }
        }

        return sanitized;
    }

    /**
     * Invalidates the cache, forcing a reload on next access
     */
    public invalidateCache(): void {
        this.cache = null;
        this.pathToIdMap = null;
        this.isInitializing = false;
        this.initializationPromise = null;
    }

    /**
     * Gets note ID by path with comprehensive validation
     * @param path - The note path to look up
     * @returns Promise resolving to note ID or null if not found
     */
    public async getNoteIdByPath(path: string): Promise<string | null> {
        try {
            // Validate input
            if (!path || typeof path !== 'string') {
                return null;
            }

            // Ensure cache is loaded
            if (!this.pathToIdMap || !this.cache) {
                await this.load(true);
            }

            // Return result with additional validation
            if (!this.pathToIdMap) {
                return null;
            }

            const result = this.pathToIdMap.get(path);
            return result && typeof result === 'string' ? result : null;
        } catch (error) {
            console.error('getNoteIdByPath failed:', error);
            return null;
        }
    }

    /**
     * Updates and saves manifest with comprehensive error handling and validation.
     * This method is the single, serialized entry point for all manifest mutations.
     * @param updateFn - Function to update the manifest draft
     */
    private async updateAndSaveManifest(updateFn: (draft: CentralManifest) => void): Promise<void> {
        // Validate input
        if (typeof updateFn !== 'function') {
            throw new TypeError('updateFn must be a function');
        }
    
        return this.queueService.enqueue(CENTRAL_MANIFEST_QUEUE_KEY, async () => {
            try {
                // The queue serializes operations. We trust our cache as the source of truth.
                // `load()` will return from cache if available, or load from settings if not.
                const currentManifest = await this.load();
    
                const newManifest = produce(currentManifest, (draft: CentralManifest) => {
                    // Apply the user's update function
                    updateFn(draft);
    
                    // Perform post-update validation and sanitization on the draft
                    if (!draft.version || typeof draft.version !== 'string') {
                        draft.version = '1.0.0'; // Sanitize to a default, not to the old value
                    }
                    if (!draft.notes || typeof draft.notes !== 'object' || Array.isArray(draft.notes)) {
                        draft.notes = {};
                    } else {
                        draft.notes = this.sanitizeNotes(draft.notes);
                    }
                });
    
                // Update the manifest in the plugin's settings object
                if (!this.plugin || !this.plugin.settings) {
                    throw new Error('Plugin settings not available');
                }
                
                this.plugin.settings.centralManifest = newManifest;
    
                // Persist the entire settings object to data.json
                await this.plugin.saveSettings();
    
                // Update the local cache and map only after the save is successful
                this.cache = newManifest;
                this.rebuildPathToIdMap();
    
            } catch (error) {
                console.error('updateAndSaveManifest failed:', error);
                // Invalidate cache on error to force a full reload on the next operation,
                // ensuring the system can recover to a known good state from disk.
                this.invalidateCache();
                throw error;
            }
        });
    }

    /**
     * Adds a note entry with comprehensive validation
     * @param noteId - The unique ID for the note
     * @param notePath - The file path of the note
     * @param noteManifestPath - The path to the note's manifest file
     */
    public async addNoteEntry(
        noteId: string,
        notePath: string,
        noteManifestPath: string
    ): Promise<void> {
        try {
            // Validate inputs
            if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
                throw new Error('Invalid noteId: must be a non-empty string');
            }
            
            if (!notePath || typeof notePath !== 'string' || notePath.trim() === '') {
                throw new Error('Invalid notePath: must be a non-empty string');
            }
            
            if (!noteManifestPath || typeof noteManifestPath !== 'string' || noteManifestPath.trim() === '') {
                throw new Error('Invalid noteManifestPath: must be a non-empty string');
            }

            const now = new Date().toISOString();
            
            await this.updateAndSaveManifest(draft => {
                // Check for duplicate notePath
                for (const [existingId, existingNote] of Object.entries(draft.notes)) {
                    if (existingNote.notePath === notePath && existingId !== noteId) {
                        console.warn(`Note with path ${notePath} already exists with ID ${existingId}`);
                        // Don't throw, just skip adding duplicate
                        return;
                    }
                }

                draft.notes[noteId] = {
                    notePath,
                    manifestPath: noteManifestPath,
                    createdAt: now,
                    lastModified: now,
                };
            });
        } catch (error) {
            console.error('addNoteEntry failed:', error);
            throw error;
        }
    }

    /**
     * Removes a note entry with comprehensive validation
     * @param noteId - The ID of the note to remove
     */
    public async removeNoteEntry(noteId: string): Promise<void> {
        try {
            // Validate input
            if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
                throw new Error('Invalid noteId: must be a non-empty string');
            }

            await this.updateAndSaveManifest(draft => {
                if (!draft.notes[noteId]) {
                    console.warn(`VC: removeNoteEntry: Note ID ${noteId} not found. No changes made.`);
                    return;
                }
                delete draft.notes[noteId];
            });
        } catch (error) {
            console.error('removeNoteEntry failed:', error);
            throw error;
        }
    }

    /**
     * Updates a note's path with comprehensive validation
     * @param noteId - The ID of the note to update
     * @param newPath - The new path for the note
     */
    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        try {
            // Validate inputs
            if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
                throw new Error('Invalid noteId: must be a non-empty string');
            }
            
            if (!newPath || typeof newPath !== 'string' || newPath.trim() === '') {
                throw new Error('Invalid newPath: must be a non-empty string');
            }

            const now = new Date().toISOString();
            
            await this.updateAndSaveManifest(draft => {
                const noteEntry = draft.notes[noteId];
                if (noteEntry) {
                    // Check for path conflicts
                    for (const [existingId, existingNote] of Object.entries(draft.notes)) {
                        if (existingNote.notePath === newPath && existingId !== noteId) {
                            console.warn(`Cannot update note ${noteId}: path ${newPath} already exists for note ${existingId}`);
                            return; // Don't update if path conflict exists
                        }
                    }
                    
                    noteEntry.notePath = newPath;
                    noteEntry.lastModified = now;
                } else {
                    console.warn(`VC: updateNotePath: Note ID ${noteId} not found. No changes made.`);
                }
            });
        } catch (error) {
            console.error('updateNotePath failed:', error);
            throw error;
        }
    }

    /**
     * Rebuilds the path to ID mapping with comprehensive validation
     */
    private rebuildPathToIdMap(): void {
        try {
            this.pathToIdMap = new Map<string, string>();
            
            if (!this.cache || !this.cache.notes) {
                return;
            }
            
            for (const [noteId, noteData] of Object.entries(this.cache.notes)) {
                try {
                    if (noteData && noteData.notePath && typeof noteData.notePath === 'string') {
                        // Check for duplicate paths
                        if (this.pathToIdMap.has(noteData.notePath)) {
                            console.warn(`Duplicate path detected: ${noteData.notePath} for note IDs ${this.pathToIdMap.get(noteData.notePath)} and ${noteId}`);
                            // Keep the first one encountered, skip duplicates
                            continue;
                        }
                        this.pathToIdMap.set(noteData.notePath, noteId);
                    }
                } catch (entryError) {
                    console.warn(`Failed to process note entry ${noteId}:`, entryError);
                    continue;
                }
            }
        } catch (error) {
            console.error('rebuildPathToIdMap failed:', error);
            this.pathToIdMap = new Map<string, string>();
        }
    }

    /**
     * Gets all note entries (for debugging and monitoring purposes)
     * @returns A copy of all note entries
     */
    public async getAllNotes(): Promise<Record<string, NoteEntry>> {
        try {
            const manifest = await this.load();
            return { ...manifest.notes };
        } catch (error) {
            console.error('getAllNotes failed:', error);
            return {};
        }
    }

    /**
     * Checks if a note exists by ID
     * @param noteId - The note ID to check
     * @returns Promise resolving to boolean indicating if note exists
     */
    public async hasNote(noteId: string): Promise<boolean> {
        try {
            if (!noteId || typeof noteId !== 'string') {
                return false;
            }
            
            const manifest = await this.load();
            return !!manifest.notes[noteId];
        } catch (error) {
            console.error('hasNote failed:', error);
            return false;
        }
    }

    /**
     * Gets note entry by ID
     * @param noteId - The note ID to retrieve
     * @returns Promise resolving to note entry or null if not found
     */
    public async getNoteById(noteId: string): Promise<NoteEntry | null> {
        try {
            if (!noteId || typeof noteId !== 'string') {
                return null;
            }
            
            const manifest = await this.load();
            const note = manifest.notes[noteId];
            return note ? { ...note } : null; // Return defensive copy
        } catch (error) {
            console.error('getNoteById failed:', error);
            return null;
        }
    }
}