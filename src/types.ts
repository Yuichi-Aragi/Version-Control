import type { TFile, EditorPosition } from "obsidian";
import type { Change } from "diff";

export interface VersionControlSettings {
  version: string;
  databasePath: string;
  noteIdFrontmatterKey: string;
  keyUpdatePathFilters: string[]; // Array of regex strings for key update blacklist
  maxVersionsPerNote: number;
  autoCleanupOldVersions: boolean;
  autoCleanupDays: number;
  defaultExportFormat: 'md' | 'json' | 'ndjson' | 'txt';
  useRelativeTimestamps: boolean;
  enableVersionNaming: boolean;
  isListView: boolean;
  renderMarkdownInPreview: boolean;
  enableWatchMode: boolean;
  watchModeInterval: number; // in seconds
  autoSaveOnSave: boolean;
  autoSaveOnSaveInterval: number; // in seconds
  enableMinLinesChangedCheck: boolean;
  minLinesChanged: number;
  autoRegisterNotes: boolean;
  pathFilters: string[]; // Array of regex strings
  centralManifest: CentralManifest;
  isGlobal?: boolean; // True if these settings are the global default. In UI state, true if a note is following global settings.
}

export interface NoteEntry {
  notePath: string;
  manifestPath: string;
  createdAt: string;
  lastModified: string;
}

export interface CentralManifest {
  version: string;
  notes: {
    [noteId: string]: NoteEntry;
  };
}

export interface BranchState {
    content: string;
    cursor: EditorPosition;
    scroll: { left: number; top: number };
}

export interface Branch {
    versions: {
        [versionId: string]: {
            versionNumber: number;
            timestamp: string;
            name?: string;
            size: number;
        };
    };
    totalVersions: number;
    // Per-branch settings can override any global setting.
    settings?: Partial<Omit<VersionControlSettings, 'databasePath' | 'centralManifest'>> & { isGlobal?: boolean };
    state?: BranchState; // Saved editor state
}

export interface NoteManifest {
  noteId: string;
  notePath: string;
  currentBranch: string;
  branches: {
      [branchName: string]: Branch;
  };
  createdAt: string;
  lastModified: string;
}

export interface VersionData {
  id: string;
  noteId: string;
  branchName: string;
  versionNumber: number;
  timestamp: string;
  name?: string;
  content: string;
  size: number;
}

export interface VersionHistoryEntry {
    id: string;
    noteId: string;
    notePath: string;
    branchName: string;
    versionNumber: number;
    timestamp: string;
    name?: string;
    size: number;
}

export interface ActiveNoteInfo {
    file: TFile | null;
    noteId: string | null;
    /** Indicates where the noteId was found, or if it was not found. */
    source: 'frontmatter' | 'manifest' | 'none';
}

/**
 * A standardized structure for representing errors within the application state.
 * This allows for consistent error handling and display.
 * @see AppState for usage.
 */
export interface AppError {
    title:string;
    message: string;
    details?: string;
}

// --- Diff-related types ---

export type DiffType = 'lines' | 'words' | 'chars' | 'json';

/** Represents a target for comparison, either a saved version or the current file state. */
export type DiffTarget = VersionHistoryEntry | {
    id: 'current';
    name: 'Current Note State';
    timestamp: string;
    notePath: string;
};

/** State for a background diff generation request. */
export interface DiffRequest {
    status: 'generating' | 'ready' | 're-diffing';
    version1: VersionHistoryEntry;
    version2: DiffTarget;
    diffChanges: Change[] | null;
    diffType: DiffType;
    content1: string;
    content2: string;
}

// --- Comlink Worker API ---
/**
 * Defines the API exposed by the diff web worker.
 * This interface is used by Comlink to create a typed proxy.
 */
export interface DiffWorkerApi {
    computeDiff(type: DiffType, content1: string, content2: string): Change[];
}
