import { TFile } from "obsidian";
import { Change } from "diff";

export interface VersionControlSettings {
  maxVersionsPerNote: number;
  autoCleanupOldVersions: boolean;
  autoCleanupDays: number;
  defaultExportFormat: 'md' | 'json' | 'ndjson' | 'txt';
  showTimestamps: boolean;
  enableVersionNaming: boolean;
  isListView: boolean;
  renderMarkdownInPreview: boolean;
  autoCleanupOrphanedVersions: boolean;
  enableWatchMode: boolean;
  watchModeInterval: number; // in seconds
}

export interface CentralManifest {
  version: string;
  notes: {
    [noteId: string]: {
      notePath: string;
      manifestPath: string;
      createdAt: string;
      lastModified: string;
    };
  };
}

export interface NoteManifest {
  noteId: string;
  notePath: string;
  versions: {
    [versionId: string]: {
      versionNumber: number;
      timestamp: string;
      name?: string;
      tags?: string[]; // Added for tagging
      filePath: string;
      size: number;
    };
  };
  totalVersions: number;
  createdAt: string;
  lastModified: string;
}

export interface VersionData {
  id: string;
  noteId: string;
  versionNumber: number;
  timestamp: string;
  name?: string;
  tags?: string[]; // Added for tagging
  content: string;
  size: number;
}

export interface VersionHistoryEntry {
    id: string;
    noteId: string;
    notePath: string; // Added for context in diffing
    versionNumber: number;
    timestamp: string;
    name?: string;
    tags?: string[]; // Added for tagging
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

/** Represents a target for comparison, either a saved version or the current file state. */
export type DiffTarget = VersionHistoryEntry | {
    id: 'current';
    name: 'Current Note State';
    timestamp: string;
    notePath: string;
};

/** State for a background diff generation request. */
export interface DiffRequest {
    status: 'generating' | 'ready';
    version1: VersionHistoryEntry;
    version2: DiffTarget;
    diffChanges: Change[] | null;
}

/** State for displaying a diff in a new tab view. */
export interface DiffViewDisplayState {
    version1: VersionHistoryEntry;
    version2: DiffTarget;
    diffChanges: Change[];
    noteName: string;
    notePath: string;
}
