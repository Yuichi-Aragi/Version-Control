import type { VersionControlSettings } from "./types";

export const VIEW_TYPE_VERSION_CONTROL = "version-control-view";
export const VIEW_TYPE_VERSION_PREVIEW = "version-preview-view";
export const VIEW_TYPE_VERSION_DIFF = "version-diff-view";
export const DB_PATH = ".versiondb";
export const NOTE_FRONTMATTER_KEY = "vc-id";

export const DEFAULT_SETTINGS: VersionControlSettings = {
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
  centralManifest: {
    version: "1.0.0",
    notes: {},
  },
};
