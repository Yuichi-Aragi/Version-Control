import { TFile } from "obsidian";

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
  content: string;
  size: number;
}

export interface VersionHistoryEntry {
    id: string;
    noteId: string;
    versionNumber: number;
    timestamp: string;
    name?: string;
    size: number;
}

export interface ActiveNoteState {
    file: TFile | null;
    noteId: string | null;
}