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
import { configureServices } from './inversify.config';
import { registerViews, addRibbonIcon, registerCommands } from './setup/UISetup';
import { registerSystemEventListeners } from './setup/EventSetup';
import { TYPES } from './types/inversify.types';
import type { CentralManifestRepository } from './core/storage/central-manifest-repository';
import type { NoteManifestRepository } from './core/storage/note-manifest-repository';
import type { QueueService } from './services/queue-service';
import { DEFAULT_SETTINGS } from './constants';
import type { CentralManifest, VersionControlSettings } from './types';
import type { PluginEvents } from './core/plugin-events';
import { AppStatus } from './state/state';
import { compareVersions } from './utils/versions';
import { VersionControlSettingTab } from './ui/settings-tab';

export interface DebouncerInfo {
    debouncer: Debouncer<[TFile], void>;
    interval: number; // in milliseconds
}

// A type representing the data structure saved to data.json
// It's the full settings object, but everything is optional for migration purposes.
type SavedData = Partial<VersionControlSettings>;

// Type guard to check if data is in old CentralManifest format
function isCentralManifest(data: any): data is CentralManifest {
    return data && 
           typeof data === 'object' && 
           'notes' in data && 
           !('databasePath' in data) && 
           !('maxVersionsPerNote' in data);
}

// Type guard to check if data is in new SavedData format
function isSavedData(data: any): data is SavedData {
    return data && 
           typeof data === 'object' && 
           ('databasePath' in data || 'maxVersionsPerNote' in data || 'centralManifest' in data);
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
        try {
            // Load settings with enhanced error handling
            await this.loadSettings();

            // Validate settings before proceeding
            if (!this.validateSettings()) {
                throw new Error("Invalid settings configuration");
            }

            // configureServices will use the plugin instance, which now holds the loaded settings.
            this.container = configureServices(this);

            // Validate container initialization
            if (!this.container) {
                throw new Error("Dependency injection container failed to initialize");
            }

            this.store = this.container.get<AppStore>(TYPES.Store);
            this.cleanupManager = this.container.get<CleanupManager>(TYPES.CleanupManager);
            const uiService = this.container.get<UIService>(TYPES.UIService);
            const manifestManager = this.container.get<ManifestManager>(TYPES.ManifestManager);
            const diffManager = this.container.get<DiffManager>(TYPES.DiffManager);
            this.backgroundTaskManager = this.container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
            const eventBus = this.container.get<PluginEvents>(TYPES.EventBus);

            // Validate critical services
            if (!this.store || !this.cleanupManager || !uiService || !manifestManager || 
                !diffManager || !this.backgroundTaskManager || !eventBus) {
                throw new Error("One or more critical services failed to initialize");
            }

            // Register the settings tab
            this.addSettingTab(new VersionControlSettingTab(this.app, this, this.store));

            this.cleanupManager.initialize();
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

            // 2. Ensure any critical, queued file operations are completed before shutdown.
            await this.completePendingOperations();

            // 3. The base Plugin class will automatically call `unload` on all child Components
            // that were added via `this.addChild()`. This handles the automatic cleanup of:
            //  - Event listeners registered in components.
            //  - Caches cleared via `component.register(() => cache.clear())`.
            //  - Intervals cleared in component `onunload` methods.

            // 4. Manually clean up the dependency injection container and its non-component services.
            await this.cleanupContainer();

            this._initialized = false;
        } catch (error) {
            console.error("Version Control: Error during unload process.", error);
        }
    }

    private async loadSettings() {
        try {
            const loadedData: SavedData | CentralManifest = await this.loadData() || {};

            let settingsData: SavedData;

            // Check if loadedData is the old manifest-only format using type guards
            if (isCentralManifest(loadedData)) {
                 // Old format: it's just a CentralManifest.
                 settingsData = { centralManifest: loadedData as CentralManifest };
            } else if (isSavedData(loadedData)) {
                 // New format or empty: it's a settings object.
                 settingsData = loadedData as SavedData;
            } else {
                // Unknown format, use defaults
                console.warn("Version Control: Unknown settings format detected, using defaults");
                settingsData = {};
            }

            // Merge defaults with loaded data. This handles migrations and new settings gracefully.
            this.settings = {
                ...DEFAULT_SETTINGS,
                ...settingsData,
                // Deep merge the central manifest to ensure its internal structure is complete.
                centralManifest: {
                    ...DEFAULT_SETTINGS.centralManifest,
                    ...(settingsData.centralManifest || {}),
                },
            };
            
            // Stamp the settings file with the current plugin version for future migrations.
            this.settings.version = this.manifest.version;

            // Save back immediately to ensure the data on disk is in the latest format.
            await this.saveSettings();
        } catch (error) {
            console.error("Version Control: Failed to load settings", error);
            // Use defaults if loading fails
            this.settings = { ...DEFAULT_SETTINGS };
            await this.saveSettings();
        }
    }

    async saveSettings() {
        try {
            // Validate settings before saving
            if (!this.validateSettings()) {
                throw new Error("Invalid settings configuration");
            }
            
            // This method saves the global settings object.
            await this.saveData(this.settings);
        } catch (error) {
            console.error("Version Control: Failed to save settings", error);
            new Notice("Failed to save settings. Please check the console for details.");
        }
    }

    private validateSettings(): boolean {
        try {
            // Basic validation of settings structure
            if (!this.settings || typeof this.settings !== 'object') {
                return false;
            }

            // Validate critical settings
            if (!this.settings.databasePath || typeof this.settings.databasePath !== 'string') {
                return false;
            }

            if (!this.settings.centralManifest || typeof this.settings.centralManifest !== 'object') {
                return false;
            }

            return true;
        } catch (error) {
            console.error("Version Control: Settings validation failed", error);
            return false;
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
                // This is a new install or an update.
                // The thunk is now responsible for updating the version upon successful display.
                this.store.dispatch(thunks.showChangelogPanel({ forceRefresh: true }));
            }
        } catch (error) {
            console.error("Version Control: Update check failed", error);
            // Don't throw here as this is not critical
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
