import type { VersionControlSettings } from "./types";
import { VersionControlSettingsSchema, HistorySettingsSchema } from "./schemas";

export const VIEW_TYPE_VERSION_CONTROL = "version-control-view";
export const DEFAULT_DB_PATH = ".versiondb";
export const CHANGELOG_URL = "https://raw.githubusercontent.com/Yuichi-Aragi/Version-Control/main/CHANGELOG.md";
export const DEFAULT_BRANCH_NAME = "main";

const DEFAULT_HISTORY_SETTINGS = HistorySettingsSchema.parse({
    // Explicit defaults for auto-registration to ensure they are present
    autoRegisterNotes: false,
    pathFilters: [],
});

export const DEFAULT_SETTINGS: VersionControlSettings = VersionControlSettingsSchema.parse({
  version: "0.0.0",
  databasePath: DEFAULT_DB_PATH,
  noteIdFrontmatterKey: 'vc-id',
  legacyNoteIdFrontmatterKeys: [],
  keyUpdatePathFilters: [],
  defaultExportFormat: 'md',
  autoRegisterNotes: false, // Deprecated/Fallback
  pathFilters: [], // Deprecated/Fallback
  centralManifest: {
    version: "1.0.0",
    notes: {},
  },
  editHistoryManifest: {
    version: "1.0.0",
    notes: {},
  },
  noteIdFormat: '{uuid}',
  versionIdFormat: '{timestamp}_{version}',
  
  versionHistorySettings: DEFAULT_HISTORY_SETTINGS,
  editHistorySettings: {
      ...DEFAULT_HISTORY_SETTINGS,
      // Default to compact list for edits
      isListView: true,
      // Maybe different defaults for edits?
      autoSaveOnSave: false, 
      enableVersionNaming: false,
      enableVersionDescription: false,
  }
});
