import { VersionControlSettings } from "./types";

export const VIEW_TYPE_VERSION_CONTROL = "version-control-view";
export const DB_PATH = ".versiondb";
export const NOTE_FRONTMATTER_KEY = "vc-id";

export const DEFAULT_SETTINGS: VersionControlSettings = {
  maxVersionsPerNote: 50,
  autoCleanupOldVersions: false,
  autoCleanupDays: 30,
  defaultExportFormat: 'md',
  showTimestamps: true,
  enableVersionNaming: true,
  isListView: false,
  renderMarkdownInPreview: true,
  autoCleanupOrphanedVersions: false,
};