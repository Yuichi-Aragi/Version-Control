export const TYPES = {
    // Obsidian & Plugin Instances
    App: Symbol.for('App'),
    Plugin: Symbol.for('Plugin'),
    Container: Symbol.for('Container'),
    
    // Providers & Managers
    SettingsProvider: Symbol.for('SettingsProvider'),
    GlobalSettingsManager: Symbol.for('GlobalSettingsManager'),
    ManifestManager: Symbol.for('ManifestManager'),
    NoteManager: Symbol.for('NoteManager'),
    CleanupManager: Symbol.for('CleanupManager'),
    VersionManager: Symbol.for('VersionManager'),
    ExportManager: Symbol.for('ExportManager'),
    DiffManager: Symbol.for('DiffManager'),
    BackgroundTaskManager: Symbol.for('BackgroundTaskManager'),

    // Services
    UIService: Symbol.for('UIService'),
    
    // Core Utilities
    EventBus: Symbol.for('EventBus'),
    Store: Symbol.for('Store'),

    // Low-level Storage Services & Repositories
    PathService: Symbol.for('PathService'),
    AtomicFileIO: Symbol.for('AtomicFileIO'),
    WriteQueue: Symbol.for('WriteQueue'),
    CentralManifestRepo: Symbol.for('CentralManifestRepo'),
    NoteManifestRepo: Symbol.for('NoteManifestRepo'),
    VersionContentRepo: Symbol.for('VersionContentRepo'),
};
