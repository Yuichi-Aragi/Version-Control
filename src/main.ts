import 'reflect-metadata'; // Must be the first import
import { Plugin, Notice, WorkspaceLeaf, debounce, type Debouncer, TFile } from 'obsidian';
import { get } from 'lodash-es';
import type { Container } from 'inversify';
import type { AppStore } from './state/store';
import { appSlice } from './state/appSlice';
import { thunks } from './state/thunks/index';
import type { CleanupManager } from './core/cleanup-manager';
import type { UIService } from './services/ui-service';
import type { ManifestManager } from './core/manifest-manager';
import type { DiffManager } from './services/diff-manager';
import type { BackgroundTaskManager } from './core/BackgroundTaskManager';
import { configureServices } from './inversify.config';
import { registerViews, addRibbonIcon, registerCommands } from './setup/UISetup';
import { registerSystemEventListeners } from './setup/EventSetup';
import { TYPES } from './types/inversify.types';
import type { CentralManifestRepository } from './core/storage/central-manifest-repository';
import type { NoteManifestRepository } from './core/storage/note-manifest-repository';
import type { QueueService } from './services/queue-service';
import { DEFAULT_SETTINGS } from './constants';
import type { CentralManifest, VersionControlSettings } from './types';

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
    public isUnloading: boolean = false;
    public settings!: VersionControlSettings;

	override async onload() {
        this.isUnloading = false; // Reset the guard flag on every load
		try {
			// Load settings. The central manifest is loaded from data.json,
            // and other settings are taken from defaults.
			await this.loadSettings();

            // configureServices will use the plugin instance, which now holds the loaded settings.
            this.container = configureServices(this);

            this.store = this.container.get<AppStore>(TYPES.Store);
            this.cleanupManager = this.container.get<CleanupManager>(TYPES.CleanupManager);
            const uiService = this.container.get<UIService>(TYPES.UIService);
            const manifestManager = this.container.get<ManifestManager>(TYPES.ManifestManager);
            const diffManager = this.container.get<DiffManager>(TYPES.DiffManager);
            this.backgroundTaskManager = this.container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);

            this.cleanupManager.initialize();
            this.addChild(this.cleanupManager);
            this.addChild(uiService); 
            this.addChild(diffManager);
            this.addChild(this.backgroundTaskManager);

			// This now initializes the .versiondb folder structure and loads the
            // central manifest from the plugin settings into the repository's cache.
			await manifestManager.initializeDatabase();

			registerViews(this, this.store);
			addRibbonIcon(this, this.store);
			registerCommands(this, this.store);
			registerSystemEventListeners(this, this.store);

            // Use the dedicated `onLayoutReady` helper. It fires once and requires no cleanup.
            this.app.workspace.onLayoutReady(() => {
                // This thunk will now load the correct settings for the active note (or defaults)
                // by using the recommended API to find the active view.
                this.store.dispatch(thunks.initializeView());
            });
			
			this.addStatusBarItem().setText('Version control ready');

		} catch (error) {
			console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = get(error, 'message', "Unknown error during loading");
			new Notice(`Version control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
            if (this.store) {
                this.store.dispatch(appSlice.actions.reportError({
                    title: "Plugin load failed",
                    message: "The version control plugin encountered a critical error during loading.",
                    details: message,
                }));
            }
		}
	}

	override async onunload() {
        this.isUnloading = true; // Set the guard flag immediately to halt new operations

        // 1. Cancel any pending debounced operations to prevent them from firing during or after unload.
        this.debouncedLeafChangeHandler?.cancel();
        this.autoSaveDebouncers.forEach(info => info.debouncer.cancel());
        this.autoSaveDebouncers.clear();

        // 2. Ensure any critical, queued file operations are completed before shutdown.
        // This is wrapped in a try-catch to guarantee that the unload process continues
        // even if this step fails, which is critical for preventing resource leaks.
        try {
            await this.cleanupManager?.completePendingCleanups();
        } catch (error) {
            console.error("Version Control: Error while completing pending cleanups on unload.", error);
        }

        // 3. The base Plugin class will automatically call `unload` on all child Components
        // that were added via `this.addChild()`. This handles the automatic cleanup of:
        //  - Event listeners registered in components.
        //  - Caches cleared via `component.register(() => cache.clear())`.
        //  - Intervals cleared in component `onunload` methods.

        // 4. Manually clean up the dependency injection container and its non-component services.
        if (this.container) {
            try {
                // Get services that hold state but aren't components.
                const centralRepo = this.container.get<CentralManifestRepository>(TYPES.CentralManifestRepo);
                const noteRepo = this.container.get<NoteManifestRepository>(TYPES.NoteManifestRepo);
                const queueService = this.container.get<QueueService>(TYPES.QueueService);

                // Invalidate caches and clear all pending task queues to prevent orphaned operations.
                centralRepo.invalidateCache();
                noteRepo.clearCache();
                queueService.clearAll();

                // Unbind all services from the DI container. This is a crucial step to allow
                // the garbage collector to reclaim memory and prevent issues on plugin reload.
                this.container.unbindAll();

            } catch (error) {
                // This might happen if the container failed to initialize or was already unbound.
                console.error("Version Control: Error during container cleanup on unload.", error);
            }
        }
	}

    async loadSettings() {
        const data = await this.loadData();

        // Check if the loaded data is the old settings format or the new manifest-only format.
        // A simple check is to see if a non-manifest setting like `maxVersionsPerNote` exists at the top level.
        const isOldFormat = data && data.hasOwnProperty('maxVersionsPerNote');
        
        let manifest: CentralManifest | null;
        if (isOldFormat) {
            // It's the old format, extract the manifest from it.
            manifest = data.centralManifest || null;
        } else {
            // It's the new format (or null), so the data is the manifest itself.
            manifest = data as CentralManifest | null;
        }

        // Construct the full settings object for runtime use.
        this.settings = {
            ...DEFAULT_SETTINGS,
            // Deep merge the loaded manifest with the default to ensure all properties are present.
            centralManifest: {
                ...DEFAULT_SETTINGS.centralManifest,
                ...(manifest || {}),
            },
        };

        // Save back in the new, manifest-only format. This completes the migration on first load.
        await this.saveSettings();
    }

    async saveSettings() {
        // Only save the central manifest to data.json. All other settings are ephemeral
        // or stored in per-note manifests.
        await this.saveData(this.settings.centralManifest);
    }
}
