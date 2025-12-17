import type { TFile } from "obsidian";
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
} from "./schemas";

// --- Inferred Types from Valibot Schemas ---

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

// --- Other Types ---

export type ViewMode = 'versions' | 'edits';

export interface ActiveNoteInfo {
    file: TFile | null;
    noteId: string | null;
    /** Indicates where the noteId was found, or if it was not found. */
    source: 'frontmatter' | 'manifest' | 'filepath' | 'none';
}

// --- Comlink Worker API ---
/**
 * Defines the API exposed by the diff web worker.
 * This interface is used by Comlink to create a typed proxy.
 */
export interface DiffWorkerApi {
    /**
     * Computes diff between two contents.
     * Accepts string or ArrayBuffer.
     * Returns ArrayBuffer (serialized Change[]) via transfer.
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
    readManifestFromZip(zipData: ArrayBuffer): Promise<any>;

    /**
     * Clears all data from the IDB.
     * Used on plugin unload to ensure next load gets fresh data from disk.
     */
    clearAll(): Promise<void>;
}

// --- Timeline Types ---

export interface TimelineStats {
    additions: number;
    deletions: number;
}

export interface TimelineEvent {
    id?: number; // Auto-incrementing ID from IndexedDB
    noteId: string;
    branchName: string;
    source: 'version' | 'edit'; // Distinguishes between version history and edit history timelines
    fromVersionId: string | null; // null indicates the start of history (creation)
    toVersionId: string;
    timestamp: string; // ISO string of the 'toVersion'
    diffData: Change[];
    stats: TimelineStats;

    // Metadata for display
    toVersionName?: string;
    toVersionNumber: number;
    toVersionDescription?: string;
}
