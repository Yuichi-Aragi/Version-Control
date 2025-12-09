import type { TFile } from "obsidian";
import { z } from "zod";
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

// --- Inferred Types from Zod Schemas ---

export type VersionControlSettings = z.infer<typeof VersionControlSettingsSchema>;
export type HistorySettings = z.infer<typeof HistorySettingsSchema>;
export type NoteEntry = z.infer<typeof NoteEntrySchema>;
export type CentralManifest = z.infer<typeof CentralManifestSchema>;
export type BranchState = z.infer<typeof BranchStateSchema>;
export type Branch = z.infer<typeof BranchSchema>;
export type NoteManifest = z.infer<typeof NoteManifestSchema>;
export type VersionData = z.infer<typeof VersionDataSchema>;
export type VersionHistoryEntry = z.infer<typeof VersionHistoryEntrySchema>;
export type AppError = z.infer<typeof AppErrorSchema>;
export type DiffType = z.infer<typeof DiffTypeSchema>;
export type DiffTarget = z.infer<typeof DiffTargetSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type DiffRequest = z.infer<typeof DiffRequestSchema>;
export type TimelineSettings = z.infer<typeof TimelineSettingsSchema>;

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
     */
    saveEdit(
        noteId: string,
        branchName: string,
        editId: string,
        content: string | ArrayBuffer,
        manifestUpdate: NoteManifest
    ): Promise<void>;

    /**
     * Retrieves edit content.
     * Returns ArrayBuffer (UTF-8 encoded string) via transfer for zero-copy.
     */
    getEditContent(noteId: string, branchName: string, editId: string): Promise<ArrayBuffer | null>;

    getEditManifest(noteId: string): Promise<NoteManifest | null>;
    
    saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void>;

    deleteEdit(noteId: string, branchName: string, editId: string): Promise<void>;
    
    deleteNoteHistory(noteId: string): Promise<void>;

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
