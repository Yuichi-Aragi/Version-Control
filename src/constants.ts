import { VersionControlSettings } from "./types";

export const VIEW_TYPE_VERSION_CONTROL = "version-control-view";
export const VIEW_TYPE_VERSION_PREVIEW = "version-preview-view";
export const VIEW_TYPE_VERSION_DIFF = "version-diff-view";
export const DB_PATH = ".versiondb";
export const NOTE_FRONTMATTER_KEY = "vc-id";

export const DEFAULT_SETTINGS: VersionControlSettings = {
  maxVersionsPerNote: 50,
  autoCleanupOldVersions: false,
  autoCleanupDays: 30,
  defaultExportFormat: 'md',
  useRelativeTimestamps: true, // FIX: Renamed from showTimestamps
  enableVersionNaming: true,
  isListView: false,
  renderMarkdownInPreview: true,
  autoCleanupOrphanedVersions: false,
  enableWatchMode: false,
  watchModeInterval: 60, // 60 seconds
  applySettingsGlobally: true, // NEW
};

// Service names for the DI container
export const SERVICE_NAMES = {
    APP: 'app',
    PLUGIN: 'plugin',
    SETTINGS_PROVIDER: 'settingsProvider',
    EVENT_BUS: 'eventBus',
    
    // High-level Managers/Services
    MANIFEST_MANAGER: 'manifestManager',
    NOTE_MANAGER: 'noteManager',
    CLEANUP_MANAGER: 'cleanupManager',
    VERSION_MANAGER: 'versionManager',
    EXPORT_MANAGER: 'exportManager',
    DIFF_MANAGER: 'diffManager',
    UI_SERVICE: 'uiService',
    STORE: 'store',
    BACKGROUND_TASK_MANAGER: 'backgroundTaskManager',
    GLOBAL_SETTINGS_MANAGER: 'globalSettingsManager', // NEW

    // Low-level Storage Services & Repositories
    PATH_SERVICE: 'pathService',
    ATOMIC_FILE_IO: 'atomicFileIO',
    WRITE_QUEUE: 'writeQueue',
    CENTRAL_MANIFEST_REPO: 'centralManifestRepo',
    NOTE_MANIFEST_REPO: 'noteManifestRepo',
    VERSION_CONTENT_REPO: 'versionContentRepo',
};
