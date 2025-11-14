import type { TFile } from "obsidian";
import { z } from "zod";
import type {
    VersionControlSettingsSchema,
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
} from "./schemas";

// --- Inferred Types from Zod Schemas ---

export type VersionControlSettings = z.infer<typeof VersionControlSettingsSchema>;
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

// --- Other Types ---

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
    computeDiff(type: DiffType, content1: string, content2: string): Change[];
}
