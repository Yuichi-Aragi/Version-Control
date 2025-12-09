import 'reflect-metadata'; // Must be the first import
import { Plugin, Notice, WorkspaceLeaf, type Debouncer, TFile } from 'obsidian';
import { get } from 'lodash-es';
import type { Container } from 'inversify';
import type { AppStore } from './state/store';
import { appSlice } from './state/appSlice';
import { thunks } from './state/thunks/index';
import type { CleanupManager } from './core/tasks/cleanup-manager';
import type { UIService } from './services/ui-service';
import type { ManifestManager } from './core/manifest-manager';
import type { DiffManager } from './services/diff-manager';
import type { BackgroundTaskManager } from './core/tasks/BackgroundTaskManager';
import type { TimelineManager } from './core/timeline-manager';
import type { CompressionManager } from './core/compression-manager';
import { configureServices } from './inversify.config';
import { registerViews, addRibbonIcon, registerCommands } from './setup/UISetup';
import { registerSystemEventListeners } from './setup/EventSetup';
import { TYPES } from './types/inversify.types';
import type { CentralManifestRepository } from './core/storage/central-manifest-repository';
import type { NoteManifestRepository } from './core/storage/note-manifest-repository';
import type { QueueService } from './services/queue-service';
import { DEFAULT_SETTINGS } from './constants';
import type { VersionControlSettings } from './types';
import type { PluginEvents } from './core/plugin-events';
import { AppStatus, type AppState } from './state/state';
import { compareVersions } from './utils/versions';
import { VersionControlSettingTab } from './ui/settings-tab';
import { CentralManifestSchema, VersionControlSettingsSchema } from './schemas';

export interface DebouncerInfo {
    debouncer: Debouncer<[TFile], void>;
    interval: number; // in milliseconds
}

export default class VersionControlPlugin extends Plugin {
    private container!: Container;
    private store!: AppStore;
    private cleanupManager!: CleanupManager;
    private backgroundTaskManager!: BackgroundTaskManager;
    public debouncedLeafChangeHandler?: Debouncer<[WorkspaceLeaf | null], void>;
    public autoSaveDebouncers = new Map<string, DebouncerInfo>();
    private _isUnloading: boolean = false;
    public settings!: VersionControlSettings;
    private _initialized: boolean = false;
    private _unloadPromise: Promise<void> | null = null;

    // --- Changelog Queue ---
    /** Holds a request to show the changelog panel if the UI is not ready. */
    public queuedChangelogRequest: { forceRefresh: boolean; isManualRequest: boolean } | null = null;

    // Getter for isUnloading with type safety
    public get isUnloading(): boolean {
        return this._isUnloading;
    }

    // Setter for isUnloading with validation
    public set isUnloading(value: boolean) {
        if (typeof value !== 'boolean') {
            throw new TypeError('isUnloading must be a boolean');
        }
        this._isUnloading = value;
    }

    // Getter for initialization status
    public get initialized(): boolean {
        return this._initialized;
    }

    override async onload() {
        // Prevent multiple initialization attempts
        if (this._initialized) {
            console.warn("Version Control: Plugin already initialized, skipping onload");
            return;
        }

        this.isUnloading = false; // Reset the guard flag on every load
        this.queuedChangelogRequest = null; // Reset queue on every load

        try {
            // Load settings with enhanced error handling
            await this.loadSettings();

            // configureServices will use the plugin instance, which now holds the loaded settings.
            this.container = configureServices(this);

            // Validate container initialization
            if (!this.container) {
                throw new Error("Dependency injection container failed to initialize");
            }

            this.store = this.container.get<AppStore>(TYPES.Store);
            this.register(this.store.subscribe(this.handleStoreChange.bind(this)));

            this.cleanupManager = this.container.get<CleanupManager>(TYPES.CleanupManager);
            const uiService = this.container.get<UIService>(TYPES.UIService);
            const manifestManager = this.container.get<ManifestManager>(TYPES.ManifestManager);
            const diffManager = this.container.get<DiffManager>(TYPES.DiffManager);
            this.backgroundTaskManager = this.container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
            const timelineManager = this.container.get<TimelineManager>(TYPES.TimelineManager);
            const eventBus = this.container.get<PluginEvents>(TYPES.EventBus);
            const compressionManager = this.container.get<CompressionManager>(TYPES.CompressionManager);

            // Validate critical services
            if (!this.store || !this.cleanupManager || !uiService || !manifestManager || 
                !diffManager || !this.backgroundTaskManager || !timelineManager || !eventBus || !compressionManager) {
                throw new Error("One or more critical services failed to initialize");
            }

            // Register the settings tab
            this.addSettingTab(new VersionControlSettingTab(this.app, this, this.store));

            this.cleanupManager.initialize();
            timelineManager.initialize();
            compressionManager.initialize();
            
            this.addChild(this.cleanupManager);
            this.addChild(uiService); 
            this.addChild(diffManager);
            this.addChild(this.backgroundTaskManager);

            // Initialize database with enhanced error handling
            await this.initializeDatabase(manifestManager);

            // Register UI components with error handling
            this.registerUIComponents();

            // Set up event listeners with proper cleanup
            this.setupEventListeners(eventBus);

            // Initialize view when layout is ready
            this.app.workspace.onLayoutReady(() => {
                if (this.isUnloading) return;
                this.initializeView();
                this.checkForUpdates();
            });

            this._initialized = true;
            
        } catch (error) {
            console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = get(error, 'message', "Unknown error during loading");
            new Notice(`Version control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
            
            // Attempt to report error to store if available
            if (this.store) {
                this.store.dispatch(appSlice.actions.reportError({
                    title: "Plugin load failed",
                    message: "The version control plugin encountered a critical error during loading.",
                    details: message,
                }));
            }
            
            // Ensure cleanup if initialization fails
            await this.performEmergencyCleanup();
        }
    }

    override async onunload() {
        // Prevent multiple unload operations
        if (this._unloadPromise) {
            return this._unloadPromise;
        }

        this._unloadPromise = this.performUnload();
        return this._unloadPromise;
    }

    private async performUnload(): Promise<void> {
        this.isUnloading = true; // Set the guard flag immediately to halt new operations

        try {
            // 1. Cancel any pending debounced operations to prevent them from firing during or after unload.
            this.cancelDebouncedOperations();
            this.queuedChangelogRequest = null;

            // 2. Ensure any critical, queued file operations are completed before shutdown.
            await this.completePendingOperations();

            // 3. The base Plugin class will automatically call `unload` on all child Components
            // that were added via `this.addChild()`. This handles the automatic cleanup of:
            //  - Event listeners registered in components.
            //  - Caches cleared via `component.register(() => cache.clear())`.
            //  - Intervals cleared in component `onunload` methods.

            const compressionManager = this.container?.get<CompressionManager>(TYPES.CompressionManager);
            if (compressionManager) {
                compressionManager.terminate();
            }

            // 4. Manually clean up the dependency injection container and its non-component services.
            await this.cleanupContainer();

            this._initialized = false;
        } catch (error) {
            console.error("Version Control: Error during unload process.", error);
        }
    }

    private async loadSettings() {
        try {
            const loadedData: any = await this.loadData() || {};
            let settingsData: Partial<VersionControlSettings>;

            // --- Migration Logic: Flat to Nested Structure ---
            // Detect legacy flat structure by checking for a known root key that moved (e.g., maxVersionsPerNote)
            // and the absence of the new container (versionHistorySettings).
            if ('maxVersionsPerNote' in loadedData && !('versionHistorySettings' in loadedData)) {
                console.log("Version Control: Migrating settings from legacy flat format.");
                try {
                    const historyKeys = [
                        'maxVersionsPerNote', 'autoCleanupOldVersions', 'autoCleanupDays',
                        'useRelativeTimestamps', 'enableVersionNaming', 'enableVersionDescription',
                        'showDescriptionInList', 'isListView', 'renderMarkdownInPreview',
                        'enableWatchMode', 'watchModeInterval', 'autoSaveOnSave',
                        'autoSaveOnSaveInterval', 'enableMinLinesChangedCheck', 'minLinesChanged',
                        'enableWordCount', 'includeMdSyntaxInWordCount', 'enableCharacterCount',
                        'includeMdSyntaxInCharacterCount', 'enableLineCount', 'includeMdSyntaxInLineCount',
                        'isGlobal', 'autoRegisterNotes', 'pathFilters'
                    ];

                    const migratedVersionSettings: any = {};
                    
                    // Extract history settings from root
                    for (const key of historyKeys) {
                        if (key in loadedData) {
                            migratedVersionSettings[key] = loadedData[key];
                        }
                    }

                    // Construct new settings object structure
                    // Note: We spread loadedData into root to preserve globals like databasePath,
                    // but VersionControlSettingsSchema.parse will strip the now-invalid flat keys.
                    const newSettings = {
                        ...DEFAULT_SETTINGS,
                        ...loadedData, 
                        versionHistorySettings: {
                            ...DEFAULT_SETTINGS.versionHistorySettings,
                            ...migratedVersionSettings
                        },
                        // editHistorySettings will take defaults as it's a new feature
                        editHistorySettings: {
                            ...DEFAULT_SETTINGS.editHistorySettings
                        }
                    };

                    // Validate and Save immediately
                    this.settings = VersionControlSettingsSchema.parse(newSettings);
                    await this.saveSettings();
                    return; // Migration successful
                } catch (migrationError) {
                    console.error("Version Control: Settings migration failed. Falling back to default loading.", migrationError);
                    // Fall through to standard loading logic if migration fails
                }
            }
    
            // Try parsing as the new full settings format first
            const settingsParseResult = VersionControlSettingsSchema.safeParse(loadedData);
            if (settingsParseResult.success) {
                settingsData = settingsParseResult.data;
            } else {
                // If that fails, try parsing as the old central manifest format for migration
                const manifestParseResult = CentralManifestSchema.safeParse(loadedData);
                if (manifestParseResult.success) {
                    // Old format: it's just a CentralManifest.
                    console.log("Version Control: Migrating settings from old central manifest format.");
                    settingsData = { centralManifest: manifestParseResult.data };
                } else {
                    // Unknown format, use defaults and log the error
                    console.warn("Version Control: Unknown or invalid settings format detected, using defaults. Validation errors:", settingsParseResult.error);
                    settingsData = {};
                }
            }
    
            // Merge defaults with loaded data, then parse to ensure the final object is valid.
            const mergedSettings = {
                ...DEFAULT_SETTINGS,
                ...settingsData,
                centralManifest: {
                    ...DEFAULT_SETTINGS.centralManifest,
                    ...(settingsData.centralManifest || {}),
                },
                versionHistorySettings: {
                    ...DEFAULT_SETTINGS.versionHistorySettings,
                    ...(settingsData.versionHistorySettings || {}),
                },
                editHistorySettings: {
                    ...DEFAULT_SETTINGS.editHistorySettings,
                    ...(settingsData.editHistorySettings || {}),
                }
            };
    
            this.settings = VersionControlSettingsSchema.parse(mergedSettings);
    
            // Save back immediately to ensure the data on disk is in the latest, valid format.
            await this.saveSettings();
        } catch (error) {
            console.error("Version Control: Failed to load and validate settings", error);
            // Use defaults if loading fails
            this.settings = { ...DEFAULT_SETTINGS };
            await this.saveSettings();
        }
    }

    async saveSettings() {
        try {
            // Validate settings with Zod before saving to ensure data integrity.
            const validatedSettings = VersionControlSettingsSchema.parse(this.settings);
            await this.saveData(validatedSettings);
        } catch (error) {
            console.error("Version Control: Failed to save settings due to validation error", error);
            new Notice("Failed to save settings. Please check the console for details.");
        }
    }

    private async initializeDatabase(manifestManager: ManifestManager): Promise<void> {
        try {
            // This now initializes the database folder structure (at the configured path)
            // and loads the central manifest from the plugin settings into the repository's cache.
            await manifestManager.initializeDatabase();
        } catch (error) {
            console.error("Version Control: Database initialization failed", error);
            throw new Error(`Database initialization failed: ${get(error, 'message', 'Unknown error')}`);
        }
    }

    private registerUIComponents(): void {
        try {
            registerViews(this, this.store);
            addRibbonIcon(this, this.store);
            registerCommands(this, this.store);
        } catch (error) {
            console.error("Version Control: UI component registration failed", error);
            throw new Error(`UI component registration failed: ${get(error, 'message', 'Unknown error')}`);
        }
    }

    private setupEventListeners(eventBus: PluginEvents): void {
        try {
            registerSystemEventListeners(this, this.store);

            // Add a listener to refresh the UI after background cleanups.
            const handleVersionDeleted = (noteId: string) => {
                if (this.isUnloading) return;
                try {
                    const state = this.store.getState();
                    if (state.status === AppStatus.READY && state.noteId === noteId && state.file) {
                        this.store.dispatch(thunks.loadHistory(state.file));
                    }
                } catch (error) {
                    console.error("Version Control: Error in version deleted handler", error);
                }
            };
            
            eventBus.on('version-deleted', handleVersionDeleted);
            this.register(() => eventBus.off('version-deleted', handleVersionDeleted));
        } catch (error) {
            console.error("Version Control: Event listener setup failed", error);
            throw new Error(`Event listener setup failed: ${get(error, 'message', 'Unknown error')}`);
        }
    }

    private initializeView(): void {
        try {
            // This thunk will now load the correct settings for the active note (or defaults)
            // by using the recommended API to find the active view.
            this.store.dispatch(thunks.initializeView());
        } catch (error) {
            console.error("Version Control: View initialization failed", error);
            new Notice("Failed to initialize view. Please check the console for details.");
        }
    }

    private async checkForUpdates(): Promise<void> {
        try {
            const currentPluginVersion = this.manifest.version;
            const savedVersion = this.settings.version || '0.0.0';

            if (compareVersions(currentPluginVersion, savedVersion) > 0) {
                // This is an automatic request on startup.
                this.store.dispatch(thunks.showChangelogPanel({ forceRefresh: true, isManualRequest: false }));
            }
        } catch (error) {
            console.error("Version Control: Update check failed", error);
            // Don't throw here as this is not critical
        }
    }

    private handleStoreChange(): void {
        if (this.isUnloading || !this.queuedChangelogRequest) {
            return;
        }
    
        const currentState = this.store.getState();
    
        const isChangelogReady = (state: AppState): boolean => {
            if (!state) return false;
            const isViewStable = state.status === AppStatus.INITIALIZING || state.status === AppStatus.READY || state.status === AppStatus.PLACEHOLDER || state.status === AppStatus.LOADING;
            const isPanelAvailable = !state.panel || state.panel.type === 'changelog';
            return isViewStable && isPanelAvailable;
        };
    
        if (isChangelogReady(currentState)) {
            // Use a timeout to avoid dispatching during a dispatch cycle.
            setTimeout(() => {
                if (this.isUnloading) return;
                // processQueuedChangelogRequest will clear the queue, so this only runs once per queued item.
                this.store.dispatch(thunks.processQueuedChangelogRequest());
            }, 0);
        }
    }

    private cancelDebouncedOperations(): void {
        try {
            this.debouncedLeafChangeHandler?.cancel();
            this.autoSaveDebouncers.forEach(info => info.debouncer.cancel());
            this.autoSaveDebouncers.clear();
        } catch (error) {
            console.error("Version Control: Error cancelling debounced operations", error);
        }
    }

    private async completePendingOperations(): Promise<void> {
        try {
            // Ensure any critical, queued file operations are completed before shutdown.
            // This is wrapped in a try-catch to guarantee that the unload process continues
            // even if this step fails, which is critical for preventing resource leaks.
            if (this.cleanupManager) {
                await this.cleanupManager.completePendingCleanups();
            }
        } catch (error) {
            console.error("Version Control: Error while completing pending cleanups on unload.", error);
        }
    }

    private async cleanupContainer(): Promise<void> {
        try {
            if (this.container) {
                // Get services that hold state but aren't components.
                const centralRepo = this.container.get<CentralManifestRepository>(TYPES.CentralManifestRepo);
                const noteRepo = this.container.get<NoteManifestRepository>(TYPES.NoteManifestRepo);
                const queueService = this.container.get<QueueService>(TYPES.QueueService);

                // Invalidate caches and clear all pending task queues to prevent orphaned operations.
                if (centralRepo) centralRepo.invalidateCache();
                if (noteRepo) noteRepo.clearCache();
                if (queueService) queueService.clearAll();

                // Unbind all services from the DI container. This is a crucial step to allow
                // the garbage collector to reclaim memory and prevent issues on plugin reload.
                this.container.unbindAll();
            }
        } catch (error) {
            // This might happen if the container failed to initialize or was already unbound.
            console.error("Version Control: Error during container cleanup on unload.", error);
        }
    }

    private async performEmergencyCleanup(): Promise<void> {
        try {
            this.cancelDebouncedOperations();
            await this.completePendingOperations();
            await this.cleanupContainer();
        } catch (error) {
            console.error("Version Control: Emergency cleanup failed", error);
        }
    }
}
