/**
 * Comprehensive Service Interfaces for Loose Coupling via Inversify Dependency Injection.
 *
 * This module defines the public contracts for ALL major services and modules in the
 * version control plugin, enabling proper abstraction, testability, and maintainability
 * through interface-based injection.
 *
 * @module types/interfaces
 *
 * ## Architecture Overview
 *
 * The interfaces are organized into the following layers:
 *
 * ### Storage Layer
 * - {@link IPathService} - Centralized path generation for database files
 * - {@link IStorageService} - Low-level filesystem operations
 * - {@link ICentralManifestRepository} - Global manifest management
 * - {@link INoteManifestRepository} - Per-note manifest management
 * - {@link IVersionContentRepository} - Version file content I/O
 * - {@link ITimelineDatabase} - Timeline worker client interface
 *
 * ### Core Manager Layer
 * - {@link IManifestManager} - Manifest loading/saving orchestration
 * - {@link INoteManager} - Note lifecycle event handling
 * - {@link IVersionManager} - Version CRUD operations
 * - {@link ITimelineManager} - Timeline generation and caching
 * - {@link IEditHistoryManager} - IndexedDB-based edit history
 * - {@link ICompressionManager} - GZIP compression via worker
 *
 * ### Service Layer
 * - {@link IDiffManager} - Diff computation with LRU caching
 * - {@link IExportManager} - Version history export operations
 * - {@link IQueueService} - Sequential task execution queues
 * - {@link IUIService} - UI notification capabilities
 *
 * ### Task Layer
 * - {@link ICleanupManager} - Orphaned version cleanup
 * - {@link IBackgroundTaskManager} - Watch mode auto-saving
 *
 * ### Event Layer
 * - {@link IPluginEvents} - Central event bus
 *
 * ## Usage
 *
 * ```typescript
 * import type { IVersionManager, IPathService } from '@/types/interfaces';
 *
 * // Bind to Inversify container
 * container.bind<IVersionManager>(TYPES.VersionManager).to(VersionManager);
 *
 * // Inject via constructor
 * constructor(@inject(TYPES.VersionManager) private versionManager: IVersionManager) {}
 * ```
 */

import type { TFile, TFolder, Component } from 'obsidian';
import type { Draft } from 'immer';
import type {
    CentralManifest,
    NoteEntry,
    NoteManifest,
    TimelineEvent,
    VersionHistoryEntry,
    DiffTarget,
    DiffType,
    Change,
    VersionData,
    HistorySettings,
} from '../types';
import type { VersionControlEvents } from '../core/plugin-events';

// ============================================================================
// RE-EXPORT EVENT TYPES FOR EXTERNAL USE
// ============================================================================

/**
 * Re-export VersionControlEvents for external use.
 * Defines the signatures for all custom events used within the plugin.
 */
export type { VersionControlEvents };

// ============================================================================
// STORAGE SERVICE INTERFACES
// ============================================================================

/**
 * Centralized path generation service for database-related file and folder paths.
 *
 * Provides consistent, validated path construction for all version control
 * database operations. All paths are normalized and validated against
 * path traversal attacks.
 *
 * @interface IPathService
 *
 * @example
 * ```typescript
 * const manifestPath = pathService.getNoteManifestPath(noteId);
 * const versionPath = pathService.getNoteVersionPath(noteId, versionId);
 * ```
 */
export interface IPathService {
    /**
     * Retrieves the root database path with fallback to default.
     * Guarantees a safe, normalized, non-empty string path.
     *
     * @returns The normalized database root path
     */
    getDbRoot(): string;

    /**
     * Generates the path for a note's database folder.
     *
     * @param noteId - Unique identifier for the note (non-empty string)
     * @returns Normalized path to the note's database folder
     * @throws Error if noteId is invalid
     */
    getNoteDbPath(noteId: string): string;

    /**
     * Generates the path to a note's manifest file.
     *
     * @param noteId - Unique identifier for the note
     * @returns Normalized path to the manifest.json file
     * @throws Error if noteId is invalid
     */
    getNoteManifestPath(noteId: string): string;

    /**
     * Generates the path to a note's versions directory.
     *
     * @param noteId - Unique identifier for the note
     * @returns Normalized path to the versions directory
     * @throws Error if noteId is invalid
     */
    getNoteVersionsPath(noteId: string): string;

    /**
     * Generates the path to a specific version of a note.
     *
     * @param noteId - Unique identifier for the note
     * @param versionId - Unique identifier for the version
     * @returns Normalized path to the version markdown file
     * @throws Error if noteId or versionId is invalid
     */
    getNoteVersionPath(noteId: string, versionId: string): string;
}

/**
 * Low-level service for direct interactions with the vault's file system adapter.
 *
 * Provides resilient file operations with built-in retry logic and
 * false-positive error mitigation for race conditions.
 *
 * @interface IStorageService
 */
export interface IStorageService {
    /**
     * Ensures a folder exists at the specified path.
     * Creates the folder if it doesn't exist.
     *
     * @param path - The full path of the folder to ensure
     * @throws Error if a file exists at the path instead of a folder
     */
    ensureFolderExists(path: string): Promise<void>;

    /**
     * Permanently and recursively deletes a folder.
     * Bypasses Obsidian's trash for internal plugin data management.
     * Resilient - will not throw if folder doesn't exist.
     *
     * @param path - The path of the folder to delete
     */
    permanentlyDeleteFolder(path: string): Promise<void>;

    /**
     * Renames a folder from an old path to a new path.
     * Includes idempotency checks and race condition handling.
     *
     * @param oldPath - The current path of the folder
     * @param newPath - The desired new path for the folder
     * @throws Error if source doesn't exist or destination is occupied
     */
    renameFolder(oldPath: string, newPath: string): Promise<void>;
}

/**
 * Repository for managing the Central Manifest.
 *
 * The central manifest tracks all notes registered with version control.
 * Uses queue-based concurrency control and Immer for immutable updates.
 *
 * @interface ICentralManifestRepository
 */
export interface ICentralManifestRepository {
    /**
     * Loads the central manifest with optional force reload.
     *
     * @param forceReload - If true, bypasses cache and reloads from disk
     * @returns The central manifest
     */
    load(forceReload?: boolean): Promise<CentralManifest>;

    /**
     * Gets note ID by its file path.
     *
     * @param path - The file path to look up
     * @returns The note ID or null if not found
     */
    getNoteIdByPath(path: string): Promise<string | null>;

    /**
     * Adds a new note entry to the manifest.
     *
     * @param noteId - Unique identifier for the note
     * @param notePath - Path to the note file
     * @param noteManifestPath - Path to the note's manifest
     */
    addNoteEntry(noteId: string, notePath: string, noteManifestPath: string): Promise<void>;

    /**
     * Removes a note entry from the manifest.
     *
     * @param noteId - The note ID to remove
     */
    removeNoteEntry(noteId: string): Promise<void>;

    /**
     * Updates the path of an existing note entry.
     *
     * @param noteId - The note ID to update
     * @param newPath - The new file path
     */
    updateNotePath(noteId: string, newPath: string): Promise<void>;

    /**
     * Invalidates the in-memory cache.
     * Forces next load to read from disk.
     */
    invalidateCache(): void;

    /**
     * Gets all notes from the manifest.
     *
     * @returns Record of note IDs to note entries
     */
    getAllNotes(): Promise<Record<string, NoteEntry>>;
}

/**
 * Repository for managing Note Manifests.
 *
 * Handles per-note manifest CRUD operations with caching,
 * validation, and migration support for legacy formats.
 *
 * @interface INoteManifestRepository
 */
export interface INoteManifestRepository {
    /**
     * Loads a note manifest by ID.
     *
     * @param noteId - The note ID to load
     * @param forceReload - If true, bypasses cache
     * @returns The note manifest or null if not found
     */
    load(noteId: string, forceReload?: boolean): Promise<NoteManifest | null>;

    /**
     * Creates a new note manifest.
     *
     * @param noteId - The note ID
     * @param notePath - The note's file path
     * @returns The created manifest
     * @throws Error if manifest already exists
     */
    create(noteId: string, notePath: string): Promise<NoteManifest>;

    /**
     * Updates an existing note manifest using an Immer draft function.
     *
     * @param noteId - The note ID to update
     * @param updateFn - Function that mutates the draft
     * @returns The updated manifest
     * @throws Error if manifest doesn't exist
     */
    update(noteId: string, updateFn: (draft: Draft<NoteManifest>) => void): Promise<NoteManifest>;

    /**
     * Invalidates the cache for a specific note.
     *
     * @param noteId - The note ID to invalidate
     */
    invalidateCache(noteId: string): void;

    /**
     * Clears all cached manifests.
     */
    clearCache(): void;
}

/**
 * Repository for managing version content files.
 *
 * Handles reading, writing, and deleting version files with
 * transparent GZIP compression/decompression and concurrency control.
 *
 * @interface IVersionContentRepository
 */
export interface IVersionContentRepository {
    /**
     * Reads version content as a string.
     * Automatically handles compression/decompression.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     * @returns The content string or null if not found
     */
    read(noteId: string, versionId: string): Promise<string | null>;

    /**
     * Reads version content as binary.
     * Returns UTF-8 encoded bytes of the text content.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     * @returns The content as ArrayBuffer or null if not found
     */
    readBinary(noteId: string, versionId: string): Promise<ArrayBuffer | null>;

    /**
     * Writes version content.
     * Automatically compresses if compression is enabled.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     * @param content - The content to write
     * @returns Object containing the content size in bytes
     */
    write(noteId: string, versionId: string, content: string): Promise<WriteResult>;

    /**
     * Deletes a version file.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     */
    delete(noteId: string, versionId: string): Promise<void>;

    /**
     * Renames a version file.
     *
     * @param noteId - The note ID
     * @param oldVersionId - The current version ID
     * @param newVersionId - The new version ID
     */
    rename(noteId: string, oldVersionId: string, newVersionId: string): Promise<void>;

    /**
     * Gets the content of the latest version.
     *
     * @param noteId - The note ID
     * @param noteManifest - The note manifest containing version info
     * @returns The latest version content or null
     */
    getLatestVersionContent(noteId: string, noteManifest: NoteManifest): Promise<string | null>;
}

/**
 * Client interface for the Timeline Worker.
 *
 * Manages timeline event generation and storage in IndexedDB
 * via a dedicated web worker for performance.
 *
 * @interface ITimelineDatabase
 */
export interface ITimelineDatabase {
    /**
     * Initializes the timeline database and worker.
     */
    initialize(): void;

    /**
     * Gets timeline events for a note.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param source - The timeline source ('version' or 'edit')
     * @returns Array of timeline events
     */
    getTimeline(noteId: string, branchName: string, source: TimelineSource): Promise<TimelineEvent[]>;

    /**
     * Generates and stores a timeline event.
     * Computes diff between two versions and creates an event.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param source - The timeline source
     * @param fromVersionId - The source version ID (null for creation)
     * @param toVersionId - The target version ID
     * @param toVersionTimestamp - ISO timestamp of target version
     * @param toVersionNumber - Version number of target
     * @param content1 - Content of source version
     * @param content2 - Content of target version
     * @param metadata - Optional name and description
     * @returns The generated timeline event
     */
    generateAndStoreEvent(
        noteId: string,
        branchName: string,
        source: TimelineSource,
        fromVersionId: string | null,
        toVersionId: string,
        toVersionTimestamp: string,
        toVersionNumber: number,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        metadata?: VersionMetadata
    ): Promise<TimelineEvent>;

    /**
     * Updates event metadata (name/description).
     *
     * @param noteId - The note ID
     * @param versionId - The version ID of the event
     * @param data - The metadata to update
     */
    updateEventMetadata(noteId: string, versionId: string, data: VersionMetadata): Promise<void>;

    /**
     * Removes an event by version ID.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param source - The timeline source
     * @param versionId - The version ID to remove
     */
    removeEventByVersion(noteId: string, branchName: string, source: TimelineSource, versionId: string): Promise<void>;

    /**
     * Clears timeline for a note.
     *
     * @param noteId - The note ID
     * @param source - Optional source filter
     */
    clearTimelineForNote(noteId: string, source?: TimelineSource): Promise<void>;

    /**
     * Clears all timeline data.
     */
    clearAll(): Promise<void>;

    /**
     * Terminates the worker and releases resources.
     */
    terminate(): void;
}

// ============================================================================
// CORE MANAGER INTERFACES
// ============================================================================

/**
 * Manages manifest loading and saving operations.
 *
 * Orchestrates interactions between central manifest and note manifests,
 * providing a unified API for manifest operations.
 *
 * @interface IManifestManager
 */
export interface IManifestManager {
    /**
     * Loads or creates a manifest for a file.
     * Creates a new manifest if one doesn't exist.
     *
     * @param file - The TFile to load/create manifest for
     * @returns The note manifest
     */
    loadOrCreateManifest(file: TFile): Promise<NoteManifest>;

    /**
     * Loads a note manifest by ID.
     *
     * @param noteId - The note ID
     * @returns The manifest or null if not found
     */
    loadNoteManifest(noteId: string): Promise<NoteManifest | null>;

    /**
     * Updates a note manifest using an update function.
     *
     * @param noteId - The note ID
     * @param updateFn - Function that modifies the manifest
     * @returns The updated manifest
     */
    updateNoteManifest(noteId: string, updateFn: (manifest: NoteManifest) => void): Promise<NoteManifest>;

    /**
     * Gets the note ID for a file.
     *
     * @param file - The TFile to look up
     * @returns The note ID or null if not registered
     */
    getNoteIdForFile(file: TFile): Promise<string | null>;

    /**
     * Loads the central manifest.
     *
     * @param forceReload - If true, bypasses cache
     * @returns The central manifest
     */
    loadCentralManifest(forceReload?: boolean): Promise<CentralManifest>;

    /**
     * Deletes a note's version history.
     *
     * @param noteId - The note ID to delete history for
     */
    deleteNoteHistory(noteId: string): Promise<void>;

    /**
     * Handles file rename events.
     * Updates manifests to reflect the new path.
     *
     * @param file - The renamed file
     * @param oldPath - The previous file path
     */
    handleFileRename(file: TFile, oldPath: string): Promise<void>;
}

/**
 * Manages note-related operations and lifecycle events.
 *
 * Handles note creation, modification, rename, and deletion events,
 * coordinating with other services to maintain version history.
 *
 * @interface INoteManager
 */
export interface INoteManager {
    /**
     * Initializes the note manager.
     * Sets up event listeners and initial state.
     */
    initialize(): void;

    /**
     * Handles active leaf change events.
     * Updates tracking when user switches notes.
     */
    handleActiveLeafChange(): void;

    /**
     * Handles file modification events.
     * May trigger auto-save based on settings.
     *
     * @param file - The modified file
     */
    handleFileModified(file: TFile): Promise<void>;

    /**
     * Handles file rename events.
     * Updates manifests and paths.
     *
     * @param file - The renamed file
     * @param oldPath - The previous file path
     */
    handleFileRenamed(file: TFile, oldPath: string): Promise<void>;

    /**
     * Handles file deletion events.
     * Cleans up version history based on settings.
     *
     * @param file - The deleted file
     */
    handleFileDeleted(file: TFile): Promise<void>;
}

/**
 * Manages version history operations.
 *
 * Provides CRUD operations for versions including creation,
 * retrieval, deletion, and restoration.
 *
 * @interface IVersionManager
 */
export interface IVersionManager {
    /**
     * Gets the version history for a note.
     * Returns versions sorted by version number (descending).
     *
     * @param noteId - The note ID
     * @returns Array of version history entries
     */
    getVersionHistory(noteId: string): Promise<VersionHistoryEntry[]>;

    /**
     * Gets the content of a specific version.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     * @returns The version content or null if not found
     */
    getVersionContent(noteId: string, versionId: string): Promise<string | null>;

    /**
     * Creates a new version.
     *
     * @param noteId - The note ID
     * @param content - The version content
     * @param notePath - The note's file path
     * @param name - Optional version name
     * @param description - Optional version description
     * @returns Object with versionId and versionNumber, or null if skipped
     */
    createVersion(
        noteId: string,
        content: string,
        notePath: string,
        name?: string,
        description?: string
    ): Promise<VersionCreationResult | null>;

    /**
     * Deletes a specific version.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID to delete
     */
    deleteVersion(noteId: string, versionId: string): Promise<void>;

    /**
     * Updates version metadata.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID
     * @param name - New name (optional)
     * @param description - New description (optional)
     */
    updateVersion(noteId: string, versionId: string, name?: string, description?: string): Promise<void>;

    /**
     * Restores a version to the active file.
     *
     * @param noteId - The note ID
     * @param versionId - The version ID to restore
     * @returns True if restoration succeeded
     */
    restoreVersion(noteId: string, versionId: string): Promise<boolean>;
}

/**
 * Manages timeline generation and events.
 *
 * Generates timeline data for visualizing version changes,
 * caching results for performance.
 *
 * @interface ITimelineManager
 */
export interface ITimelineManager {
    /**
     * Initializes the timeline manager.
     * Sets up the timeline database and event listeners.
     */
    initialize(): void;

    /**
     * Gets or generates timeline for a note.
     * Automatically fills gaps and removes orphaned events.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param source - The timeline source
     * @returns Array of timeline events
     */
    getOrGenerateTimeline(noteId: string, branchName: string, source: TimelineSource): Promise<TimelineEvent[]>;
}

/**
 * Manages edit history operations (IndexedDB-based).
 *
 * Provides a separate, more granular history tracking mechanism
 * for individual edits beyond saved versions.
 *
 * @interface IEditHistoryManager
 */
export interface IEditHistoryManager {
    /**
     * Initializes the edit history manager.
     */
    initialize(): void;

    /**
     * Saves an edit.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param editId - The edit ID
     * @param content - The edit content
     * @param manifest - The manifest update
     */
    saveEdit(noteId: string, branchName: string, editId: string, content: string, manifest: NoteManifest): Promise<void>;

    /**
     * Gets edit content.
     *
     * @param noteId - The note ID
     * @param editId - The edit ID
     * @param branchName - Optional branch name
     * @returns The edit content or null
     */
    getEditContent(noteId: string, editId: string, branchName?: string): Promise<string | null>;

    /**
     * Gets the edit manifest for a note.
     *
     * @param noteId - The note ID
     * @returns The edit manifest or null
     */
    getEditManifest(noteId: string): Promise<NoteManifest | null>;

    /**
     * Gets edit history for a note.
     *
     * @param noteId - The note ID
     * @returns Array of version history entries
     */
    getEditHistory(noteId: string): Promise<VersionHistoryEntry[]>;

    /**
     * Saves the edit manifest.
     *
     * @param noteId - The note ID
     * @param manifest - The manifest to save
     */
    saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void>;

    /**
     * Deletes an edit.
     *
     * @param noteId - The note ID
     * @param branchName - The branch name
     * @param editId - The edit ID
     */
    deleteEdit(noteId: string, branchName: string, editId: string): Promise<void>;

    /**
     * Deletes all edit history for a note.
     *
     * @param noteId - The note ID
     */
    deleteNoteHistory(noteId: string): Promise<void>;

    /**
     * Renames an edit.
     *
     * @param noteId - The note ID
     * @param oldEditId - The current edit ID
     * @param newEditId - The new edit ID
     */
    renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void>;

    /**
     * Renames a note in edit history.
     *
     * @param oldNoteId - The current note ID
     * @param newNoteId - The new note ID
     * @param newPath - The new file path
     */
    renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void>;

    /**
     * Updates a note's path in edit history.
     *
     * @param noteId - The note ID
     * @param newPath - The new file path
     */
    updateNotePath(noteId: string, newPath: string): Promise<void>;

    /**
     * Registers a note in the central edit manifest.
     *
     * @param noteId - The note ID
     * @param notePath - The note's file path
     */
    registerNoteInCentralManifest(noteId: string, notePath: string): Promise<void>;

    /**
     * Unregisters a note from the central edit manifest.
     *
     * @param noteId - The note ID
     */
    unregisterNoteFromCentralManifest(noteId: string): Promise<void>;

    /**
     * Terminates the edit history worker.
     */
    terminate(): void;
}

/**
 * Manages compression/decompression operations via worker.
 *
 * Provides GZIP compression for version content to reduce
 * storage space and improve I/O performance.
 *
 * @interface ICompressionManager
 */
export interface ICompressionManager {
    /**
     * Initializes the compression manager.
     */
    initialize(): void;

    /**
     * Compresses content using GZIP.
     *
     * @param content - The content to compress (string or ArrayBuffer)
     * @returns The compressed ArrayBuffer
     */
    compress(content: string | ArrayBuffer): Promise<ArrayBuffer>;

    /**
     * Decompresses GZIP content.
     *
     * @param content - The compressed ArrayBuffer
     * @returns The decompressed string
     */
    decompress(content: ArrayBuffer): Promise<string>;

    /**
     * Terminates the compression worker.
     */
    terminate(): void;
}

// ============================================================================
// SERVICE INTERFACES
// ============================================================================

/**
 * Worker health statistics for monitoring.
 *
 * @interface WorkerHealthStats
 */
export interface WorkerHealthStats {
    /** Number of consecutive errors */
    consecutiveErrors: number;
    /** Total number of operations performed */
    operationCount: number;
    /** Average operation time in milliseconds */
    averageOperationTime: number;
}

/**
 * Worker status information.
 *
 * @interface WorkerStatus
 */
export interface WorkerStatus {
    /** Whether the worker is initialized */
    isInitialized: boolean;
    /** Whether the worker is currently active */
    isActive: boolean;
    /** Whether the worker is in a healthy state */
    isHealthy: boolean;
    /** Detailed health statistics */
    healthStats: WorkerHealthStats;
}

/**
 * Cache statistics for monitoring.
 *
 * @interface CacheStats
 */
export interface CacheStats {
    /** Current number of cached entries */
    size: number;
    /** Maximum cache capacity */
    capacity: number;
    /** Cache utilization as a decimal (0-1) */
    utilization: number;
}

/**
 * Manages keyed p-queue instances for sequential execution.
 *
 * Ensures operations on specific resources are executed
 * sequentially to prevent race conditions.
 *
 * @interface IQueueService
 */
export interface IQueueService {
    /**
     * Enqueues a task for sequential execution.
     * Tasks with the same key are executed in order.
     *
     * @param key - The queue key (e.g., note ID)
     * @param task - The task function to execute
     * @returns A promise that resolves with the task result
     */
    enqueue<T>(key: string, task: TaskFunction<T>): Promise<T>;

    /**
     * Clears a specific queue and stops pending tasks.
     *
     * @param key - The queue key to clear
     */
    clear(key: string): void;

    /**
     * Clears all queues.
     * Critical for plugin unload cleanup.
     */
    clearAll(): void;

    /**
     * Waits for a queue to become idle.
     *
     * @param key - The queue key to wait for
     */
    onIdle(key: string): Promise<void>;
}

/**
 * Manages diff computation via worker.
 *
 * Computes diffs between versions using a dedicated web worker
 * with LRU caching for performance optimization.
 *
 * @interface IDiffManager
 * @extends Component
 */
export interface IDiffManager extends Component {
    /**
     * Gets content for a diff target.
     * Handles both current file content and saved versions.
     *
     * @param noteId - The note ID
     * @param target - The diff target specification
     * @returns The content as string or ArrayBuffer
     * @throws Error if content cannot be retrieved
     */
    getContent(noteId: string, target: DiffTarget): Promise<string | ArrayBuffer>;

    /**
     * Computes a diff between two versions.
     *
     * @param noteId - The note ID
     * @param version1Id - The first version ID
     * @param version2Id - The second version ID
     * @param content1 - Content of first version
     * @param content2 - Content of second version
     * @param diffType - The type of diff to compute
     * @returns Array of changes
     * @throws Error on failure
     */
    computeDiff(
        noteId: string,
        version1Id: string,
        version2Id: string,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        diffType: DiffType
    ): Promise<Change[]>;

    /**
     * Invalidates cache for a note.
     * Called when versions are modified.
     *
     * @param noteId - The note ID
     */
    invalidateCacheForNote(noteId: string): Promise<void>;

    /**
     * Restarts the diff worker.
     * Used for recovery after errors.
     */
    restartWorker(): Promise<void>;

    /**
     * Gets worker status information.
     *
     * @returns Current worker status
     */
    getWorkerStatus(): WorkerStatus;

    /**
     * Gets cache statistics.
     *
     * @returns Current cache statistics
     */
    getCacheStats(): Promise<CacheStats>;
}

/**
 * Manages export operations.
 *
 * Handles exporting version history to various file formats
 * with validation and error handling.
 *
 * @interface IExportManager
 */
export interface IExportManager {
    /**
     * Gets all versions data for a note.
     * Fetches content for each version with batched processing.
     *
     * @param noteId - The note ID
     * @returns Array of version data with content
     */
    getAllVersionsData(noteId: string): Promise<VersionData[]>;

    /**
     * Formats export data to a specific format.
     *
     * @param versionsData - Array of version data to format
     * @param format - The target format
     * @returns The formatted string
     * @throws Error if format is unknown or formatting fails
     */
    formatExportData(versionsData: VersionData[], format: ExportFormat): string;

    /**
     * Writes content to a file.
     * Handles conflicts and creates unique filenames if needed.
     *
     * @param folder - The target folder
     * @param fileName - The desired file name
     * @param content - The content to write
     * @returns The full path of the created file
     * @throws Error if write operation fails
     */
    writeFile(folder: TFolder, fileName: string, content: string): Promise<string>;
}

/**
 * Manages UI interactions.
 *
 * Provides UI notification capabilities decoupled from
 * business logic.
 *
 * @interface IUIService
 * @extends Component
 */
export interface IUIService extends Component {
    /**
     * Shows a notice to the user.
     *
     * @param message - The message to display
     * @param duration - Duration in milliseconds (default: 5000)
     */
    showNotice(message: string, duration?: number): void;
}

/**
 * Central event bus for the plugin.
 *
 * Provides typed event handling for cross-component communication.
 *
 * @interface IPluginEvents
 */
export interface IPluginEvents {
    /**
     * Registers a callback for an event.
     *
     * @param name - The event name
     * @param callback - The callback function
     * @param ctx - Optional context to bind the callback to
     */
    on<K extends keyof VersionControlEvents>(name: K, callback: VersionControlEvents[K], ctx?: unknown): void;

    /**
     * Unregisters a callback for an event.
     *
     * @param name - The event name
     * @param callback - The callback to unregister
     */
    off<K extends keyof VersionControlEvents>(name: K, callback: VersionControlEvents[K]): void;

    /**
     * Triggers an event.
     *
     * @param name - The event name
     * @param args - The event arguments
     */
    trigger<K extends keyof VersionControlEvents>(name: K, ...args: Parameters<VersionControlEvents[K]>): void;
}

// ============================================================================
// TASK MANAGER INTERFACES
// ============================================================================

/**
 * Cleanup operation result.
 *
 * @interface CleanupResult
 */
export interface CleanupResult {
    /** Number of orphaned note directories deleted */
    deletedNoteDirs: number;
    /** Number of orphaned version files deleted */
    deletedVersionFiles: number;
    /** Whether the cleanup completed successfully */
    success: boolean;
    /** Array of error messages if any */
    errors?: string[];
}

/**
 * Manages cleanup operations for version history.
 *
 * Handles cleanup of orphaned versions based on retention
 * policies and cleanup of data for deleted notes.
 *
 * @interface ICleanupManager
 * @extends Component
 */
export interface ICleanupManager extends Component {
    /**
     * Initializes the cleanup manager.
     * Sets up event listeners for version-saved and history-deleted.
     */
    initialize(): void;

    /**
     * Schedules a cleanup for a specific note.
     * Applies retention policies (max versions, age-based cleanup).
     *
     * @param noteId - The note ID to schedule cleanup for
     */
    scheduleCleanup(noteId: string): void;

    /**
     * Cleans up orphaned versions across all notes.
     * Removes note directories and version files not in manifests.
     *
     * @returns Result of the cleanup operation
     */
    cleanupOrphanedVersions(): Promise<CleanupResult>;

    /**
     * Waits for all pending cleanups to complete.
     * Used during plugin unload.
     */
    completePendingCleanups(): Promise<void>;
}

/**
 * Manages periodic background tasks (watch mode auto-saving).
 *
 * Handles dual-mode tracking for Version History and Edit History
 * with independent timers and settings.
 *
 * @interface IBackgroundTaskManager
 * @extends Component
 */
export interface IBackgroundTaskManager extends Component {
    /**
     * Synchronizes watch mode state with current application state.
     * Should be called when active note changes, settings change,
     * or a save occurs.
     */
    syncWatchMode(): Promise<void>;
}

// ============================================================================
// PLUGIN INTERFACES
// ============================================================================

/**
 * Core plugin interface for version control functionality.
 *
 * Defines the main plugin API accessible throughout the application.
 *
 * @interface IVersionControlPlugin
 */
export interface IVersionControlPlugin {
    /** Plugin settings */
    readonly settings: IPluginSettings;

    /** Save settings to disk */
    saveSettings(): Promise<void>;
}

/**
 * Plugin settings interface.
 *
 * @interface IPluginSettings
 */
export interface IPluginSettings {
    /** Database path for version storage */
    databasePath: string;
    /** Whether compression is enabled */
    enableCompression: boolean;
    /** Central manifest data */
    centralManifest: CentralManifest;
    /** Version history settings */
    versionHistorySettings: HistorySettings;
    /** Edit history settings */
    editHistorySettings: HistorySettings;
}

// ============================================================================
// UTILITY TYPE DEFINITIONS
// ============================================================================

/**
 * Timeline source type.
 * Distinguishes between version history and edit history timelines.
 */
export type TimelineSource = 'version' | 'edit';

/**
 * Export format options.
 */
export type ExportFormat = 'md' | 'json' | 'ndjson' | 'txt';

/**
 * Task function that can be sync or async.
 *
 * @template T - Return type
 */
export type TaskFunction<T> = () => Promise<T> | T;

/**
 * Metadata for version updates.
 */
export interface VersionMetadata {
    /** Optional version name */
    name?: string;
    /** Optional version description */
    description?: string;
}

/**
 * Version creation result.
 */
export interface VersionCreationResult {
    /** The created version ID */
    versionId: string;
    /** The version number */
    versionNumber: number;
}

/**
 * Write operation result.
 */
export interface WriteResult {
    /** Size of written content in bytes */
    size: number;
}

/**
 * Generic async function type.
 *
 * @template T - Return type
 */
export type AsyncFunction<T> = () => Promise<T>;

/**
 * Event callback type.
 *
 * @template Args - Argument types
 */
export type EventCallback<Args extends unknown[]> = (...args: Args) => void;

/**
 * View mode for the plugin UI.
 */
export type ViewMode = 'versions' | 'edits';

/**
 * Active note information used by the plugin.
 */
export interface ActiveNoteInfo {
    /** The active file or null */
    file: TFile | null;
    /** The note ID or null */
    noteId: string | null;
    /** Where the noteId was found */
    source: NoteIdSource;
}

/**
 * Source of a note ID.
 */
export type NoteIdSource = 'frontmatter' | 'manifest' | 'filepath' | 'none';
