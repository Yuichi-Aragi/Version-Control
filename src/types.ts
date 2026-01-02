import type { TFile, TFolder } from "obsidian";
import type * as v from "valibot";
import type {
    VersionControlSettingsSchema,
    HistorySettingsSchema,
    NoteEntrySchema,
    CentralManifestSchema,
    BranchStateSchema,
    BranchSchema,
    NoteManifestSchema,
    VersionDataSchema,
    VersionHistoryEntrySchema,
    AppErrorSchema,
    DiffTypeSchema,
    DiffTargetSchema,
    DiffRequestSchema,
    ChangeSchema,
    TimelineSettingsSchema,
    TimelineEventSchema,
    OperationPrioritySchema,
    OperationMetadataSchema,
    ScheduledWriteSchema,
    EditHistoryStatsSchema,
    WorkerHealthStatsSchema,
    WorkerStatusSchema,
    CacheStatsSchema,
    RetentionSettingsSchema,
    CleanupResultSchema,
    GenericVersionMetadataSchema,
    TimelineStatsSchema,
} from "./schemas";

// ============================================================================
// INFERRED TYPES FROM VALIBOT SCHEMAS
// ============================================================================

export type VersionControlSettings = v.InferOutput<typeof VersionControlSettingsSchema>;
export type HistorySettings = v.InferOutput<typeof HistorySettingsSchema>;
export type NoteEntry = v.InferOutput<typeof NoteEntrySchema>;
export type CentralManifest = v.InferOutput<typeof CentralManifestSchema>;
export type BranchState = v.InferOutput<typeof BranchStateSchema>;
export type Branch = v.InferOutput<typeof BranchSchema>;
export type NoteManifest = v.InferOutput<typeof NoteManifestSchema>;
export type VersionData = v.InferOutput<typeof VersionDataSchema>;
export type VersionHistoryEntry = v.InferOutput<typeof VersionHistoryEntrySchema>;
export type AppError = v.InferOutput<typeof AppErrorSchema>;
export type DiffType = v.InferOutput<typeof DiffTypeSchema>;
export type DiffTarget = v.InferOutput<typeof DiffTargetSchema>;
export type Change = v.InferOutput<typeof ChangeSchema>;
export type DiffRequest = v.InferOutput<typeof DiffRequestSchema>;
export type TimelineSettings = v.InferOutput<typeof TimelineSettingsSchema>;
export type TimelineEvent = v.InferOutput<typeof TimelineEventSchema>;
export type OperationPriority = v.InferOutput<typeof OperationPrioritySchema>;
export type OperationMetadata = v.InferOutput<typeof OperationMetadataSchema>;
export type ScheduledWrite = v.InferOutput<typeof ScheduledWriteSchema>;
export type EditHistoryStats = v.InferOutput<typeof EditHistoryStatsSchema>;
export type WorkerHealthStats = v.InferOutput<typeof WorkerHealthStatsSchema>;
export type WorkerStatus = v.InferOutput<typeof WorkerStatusSchema>;
export type CacheStats = v.InferOutput<typeof CacheStatsSchema>;
export type RetentionSettings = v.InferOutput<typeof RetentionSettingsSchema>;
export type CleanupResult = v.InferOutput<typeof CleanupResultSchema>;
export type GenericVersionMetadata = v.InferOutput<typeof GenericVersionMetadataSchema>;
export type TimelineStats = v.InferOutput<typeof TimelineStatsSchema>;

// ============================================================================
// OTHER TYPES
// ============================================================================

/**
 * View mode for the version control panel.
 */
export type ViewMode = 'versions' | 'edits';

/**
 * Information about the currently active note.
 */
export interface ActiveNoteInfo {
    file: TFile | null;
    noteId: string | null;
    /** Indicates where the noteId was found, or if it was not found. */
    source: 'frontmatter' | 'manifest' | 'filepath' | 'none';
}

// ============================================================================
// COMLINK WORKER APIs
// ============================================================================

/**
 * Defines the API exposed by the diff web worker.
 * This interface is used by Comlink to create a typed proxy.
 */
export interface DiffWorkerApi {
    /**
     * Computes diff between two contents.
     * Accepts string or ArrayBuffer.
     * Returns ArrayBuffer (serialized Change[] or HTML string for visual diff) via transfer.
     */
    computeDiff(type: DiffType, content1: string | ArrayBuffer, content2: string | ArrayBuffer): Promise<ArrayBuffer>;
}

/**
 * Defines the API exposed by the compression web worker.
 */
export interface CompressionWorkerApi {
    /**
     * Compresses content using GZIP.
     * Accepts string or ArrayBuffer.
     * Returns ArrayBuffer (GZIP binary) via transfer.
     * @param content The content to compress.
     * @param level Compression level (0-9). Default is 9.
     */
    compress(content: string | ArrayBuffer, level?: number): Promise<ArrayBuffer>;

    /**
     * Decompresses GZIP content.
     * Accepts ArrayBuffer.
     * Returns string.
     */
    decompress(content: ArrayBuffer): Promise<string>;

    /**
     * Creates a ZIP archive from multiple files.
     * @param files Map of filename to content (string or ArrayBuffer).
     * @param level Compression level (0-9). Default is 9.
     * @returns ArrayBuffer (ZIP binary) via transfer.
     */
    createZip(files: Record<string, string | ArrayBuffer>, level?: number): Promise<ArrayBuffer>;
}

/**
 * Defines the API exposed by the timeline web worker.
 * Handles both IndexedDB interactions and diff computation for timeline events.
 *
 * Note: Data-heavy methods return ArrayBuffer (serialized JSON) to allow
 * zero-copy transfer of ownership from worker to main thread.
 */
export interface TimelineWorkerApi {
    /** Returns ArrayBuffer containing serialized TimelineEvent[] */
    getTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<ArrayBuffer>;

    /** Returns ArrayBuffer containing serialized TimelineEvent */
    generateAndStoreEvent(
        noteId: string,
        branchName: string,
        source: 'version' | 'edit',
        fromVersionId: string | null,
        toVersionId: string,
        toVersionTimestamp: string,
        toVersionNumber: number,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        metadata?: { name?: string; description?: string }
    ): Promise<ArrayBuffer>;

    updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void>;
    removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void>;
    clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void>;
    clearAll(): Promise<void>;
}

/**
 * Defines the API exposed by the Edit History web worker.
 * Handles IndexedDB interactions for Edit History and compression.
 */
export interface EditWorkerApi {
    /**
     * Saves an edit.
     * Accepts content as string or ArrayBuffer (which will be compressed).
     * Returns statistics about the saved edit.
     */
    saveEdit(
        noteId: string,
        branchName: string,
        editId: string,
        content: string | ArrayBuffer,
        manifestUpdate: NoteManifest
    ): Promise<{ size: number; contentHash: string }>;

    /**
     * Retrieves edit content.
     * Returns ArrayBuffer (UTF-8 encoded string) via transfer for zero-copy.
     */
    getEditContent(noteId: string, branchName: string, editId: string): Promise<ArrayBuffer | null>;

    getEditManifest(noteId: string): Promise<NoteManifest | null>;

    saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void>;

    deleteEdit(noteId: string, branchName: string, editId: string): Promise<void>;

    deleteNoteHistory(noteId: string): Promise<void>;

    deleteBranch(noteId: string, branchName: string): Promise<void>;

    renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void>;

    /**
     * Renames a note ID across all edits and manifests in the database.
     * Also updates the note path in the manifest.
     */
    renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void>;

    /**
     * Updates the note path in the manifest for a given note ID.
     */
    updateNotePath(noteId: string, newPath: string): Promise<void>;

    /**
     * Exports all edit data for a branch as a compressed ZIP buffer.
     * This is used to persist the IDB state to disk as a .vctrl file.
     */
    exportBranchData(noteId: string, branchName: string): Promise<ArrayBuffer>;

    /**
     * Imports branch data from a compressed ZIP buffer into IDB.
     * This overwrites any existing data for the branch in IDB.
     */
    importBranchData(noteId: string, branchName: string, zipData: ArrayBuffer): Promise<void>;

    /**
     * Reads the manifest.json from a .vctrl zip buffer without importing the full data.
     * Used for timestamp comparison.
     */
    readManifestFromZip(zipData: ArrayBuffer): Promise<unknown>;

    /**
     * Clears all data from the IDB.
     * Used on plugin unload to ensure next load gets fresh data from disk.
     */
    clearAll(): Promise<void>;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error codes for DiffManager operations.
 */
export type DiffManagerErrorCode =
    | 'WORKER_CODE_MISSING'
    | 'WORKER_INIT_FAILED'
    | 'WORKER_PROXY_MISSING'
    | 'WORKER_TEST_FAILED'
    | 'WORKER_UNAVAILABLE'
    | 'INVALID_NOTE_ID'
    | 'INVALID_TARGET'
    | 'INVALID_NOTE_PATH'
    | 'FILE_NOT_FOUND'
    | 'VERSION_CONTENT_NOT_FOUND'
    | 'OPERATION_TIMEOUT'
    | 'INIT_FAILED'
    | 'CONTENT_TOO_LARGE'
    | 'DIFF_OPERATION_FAILED'
    | 'WORKER_RESTART_FAILED';

/**
 * Error class for DiffManager operations.
 */
export class DiffManagerError extends Error {
    constructor(
        message: string,
        public readonly code: DiffManagerErrorCode,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'DiffManagerError';
    }
}

/**
 * Error codes for EditHistoryManager operations.
 */
export type EditHistoryErrorCode =
    | 'WORKER_UNAVAILABLE'
    | 'DISK_WRITE_FAILED'
    | 'DISK_READ_FAILED'
    | 'OPERATION_TIMEOUT'
    | 'OPERATION_CANCELLED'
    | 'INTEGRITY_CHECK_FAILED'
    | 'CONCURRENCY_CONFLICT'
    | 'INVALID_STATE'
    | 'CAPACITY_EXCEEDED';

/**
 * Error class for EditHistoryManager operations.
 */
export class EditHistoryError extends Error {
    readonly timestamp: number;
    readonly operationId?: string;

    constructor(
        message: string,
        readonly code: EditHistoryErrorCode,
        readonly metadata: Partial<OperationMetadata> = {},
        override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'EditHistoryError';
        this.timestamp = Date.now();
        if (metadata.id !== undefined) {
            this.operationId = metadata.id;
        }
        Object.freeze(this);
    }

    static isRetryable(error: unknown): boolean {
        if (!(error instanceof EditHistoryError)) return false;
        
        switch (error.code) {
            case 'OPERATION_TIMEOUT':
            case 'DISK_WRITE_FAILED':
            case 'DISK_READ_FAILED':
                return true;
            default:
                return false;
        }
    }
}

// ============================================================================
// VERSION MANAGER TYPES
// ============================================================================

/**
 * Options for saving a new version of a file.
 */
export interface SaveVersionOptions {
    name?: string;
    force?: boolean;
    isAuto?: boolean;
    settings: VersionControlSettings;
}

/**
 * Result of a save operation.
 */
export interface SaveVersionResult {
    status: 'saved' | 'duplicate' | 'skipped_min_lines';
    newVersionEntry: VersionHistoryEntry | null;
    displayName: string;
    newNoteId: string;
}

/**
 * Options for updating version details.
 */
export interface UpdateVersionDetails {
    name?: string;
    description?: string;
}

/**
 * Parameters for creating a deviation from a version.
 */
export interface CreateDeviationParams {
    noteId: string;
    versionId: string;
    targetFolder: TFolder | null;
}

/**
 * Parameters for creating a deviation from content.
 */
export interface CreateDeviationFromContentParams {
    noteId: string;
    content: string;
    targetFolder: TFolder | null;
    suffix: string;
}

/**
 * Restore operation parameters.
 */
export interface RestoreVersionParams {
    liveFile: TFile;
    noteId: string;
    versionId: string;
}

/**
 * Delete operation parameters.
 */
export interface DeleteVersionParams {
    noteId: string;
    versionId: string;
}

/**
 * Defines the priority levels for tasks within the system.
 * Higher values indicate higher priority.
 */
export enum TaskPriority {
    /**
     * User-initiated, blocking operations that must complete immediately.
     * Examples: Manual Save, Restore, Delete.
     */
    CRITICAL = 100,

    /**
     * Important operations that should block lower priority tasks but aren't immediate user blocks.
     * Examples: Auto-save, UI updates.
     */
    HIGH = 50,

    /**
     * Standard operations.
     * Examples: Loading history, reading file content.
     */
    NORMAL = 0,

    /**
     * Deferrable operations.
     * Examples: Indexing, pre-fetching.
     */
    LOW = -50,

    /**
     * Invisible background maintenance.
     * Examples: Cleanup, compression, integrity checks.
     */
    BACKGROUND = -100
}

/**
 * Options for scheduling a task.
 */
export interface TaskOptions {
    /**
     * The priority of the task. Defaults to TaskPriority.NORMAL.
     */
    priority?: TaskPriority;
    
    /**
     * Optional label for debugging and logging.
     */
    label?: string;
}
