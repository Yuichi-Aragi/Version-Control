import type { VersionControlSettings } from "./types";

export const VIEW_TYPE_VERSION_CONTROL = "version-control-view";
export const DEFAULT_DB_PATH = ".versiondb";
export const CHANGELOG_URL = "https://raw.githubusercontent.com/Yuichi-Aragi/Version-Control/main/CHANGELOG.md";
export const DEFAULT_BRANCH_NAME = "main";

export const DEFAULT_SETTINGS: VersionControlSettings = {
  version: "0.0.0",
  databasePath: DEFAULT_DB_PATH,
  noteIdFrontmatterKey: 'vc-id',
  keyUpdatePathFilters: [],
  maxVersionsPerNote: 50,
  autoCleanupOldVersions: false,
  autoCleanupDays: 60,
  defaultExportFormat: 'md',
  useRelativeTimestamps: true,
  enableVersionNaming: true,
  isListView: false,
  renderMarkdownInPreview: true,
  enableWatchMode: false,
  watchModeInterval: 60, // 60 seconds
  autoSaveOnSave: false,
  autoSaveOnSaveInterval: 2, // 2 seconds
  enableMinLinesChangedCheck: false,
  minLinesChanged: 5,
  autoRegisterNotes: false,
  pathFilters: [],
  centralManifest: {
    version: "1.0.0",
    notes: {},
  },
};
