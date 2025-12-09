export const TYPES = {
  // Obsidian & Plugin Instances
  App: Symbol.for('App'),
  Plugin: Symbol.for('Plugin'),
  Container: Symbol.for('Container'),
  // Providers & Managers
  ManifestManager: Symbol.for('ManifestManager'),
  NoteManager: Symbol.for('NoteManager'),
  CleanupManager: Symbol.for('CleanupManager'),
  VersionManager: Symbol.for('VersionManager'),
  ExportManager: Symbol.for('ExportManager'),
  DiffManager: Symbol.for('DiffManager'),
  BackgroundTaskManager: Symbol.for('BackgroundTaskManager'),
  TimelineManager: Symbol.for('TimelineManager'),
  EditHistoryManager: Symbol.for('EditHistoryManager'),
  CompressionManager: Symbol.for("CompressionManager"),
  // Services
  UIService: Symbol.for('UIService'),
  QueueService: Symbol.for('QueueService'),
  // Core Utilities
  EventBus: Symbol.for('EventBus'),
  Store: Symbol.for('Store'),
  // Low-level Storage Services & Repositories
  PathService: Symbol.for('PathService'),
  StorageService: Symbol.for('StorageService'),
  CentralManifestRepo: Symbol.for('CentralManifestRepo'),
  NoteManifestRepo: Symbol.for('NoteManifestRepo'),
  VersionContentRepo: Symbol.for('VersionContentRepo'),
  TimelineDatabase: Symbol.for('TimelineDatabase'),
};
