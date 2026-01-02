import type { NoteManifest as CoreNoteManifest, CentralManifest as CoreCentralManifest } from '@/types';

export interface CleanupResult {
  deletedNoteDirs: number;
  deletedVersionFiles: number;
  deletedDuplicates: number;
  deletedOrphans: number;
  recoveredNotes: number;
  success: boolean;
  errors?: string[];
}

export type NoteManifest = CoreNoteManifest;
export type CentralManifest = CoreCentralManifest;

// Generic interface for version metadata compatible with both NoteManifest and EditManifest
export interface GenericVersionMetadata {
    versionNumber: number;
    timestamp: string;
    [key: string]: any;
}

export type VersionMap = Record<string, GenericVersionMetadata>;
