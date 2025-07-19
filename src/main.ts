import 'reflect-metadata'; // Must be the first import
import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { get, debounce } from 'lodash-es';
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

export default class VersionControlPlugin extends Plugin {
	private container!: Container;
    private store!: AppStore;
    private cleanupManager!: CleanupManager;
    private backgroundTaskManager!: BackgroundTaskManager;
    public debouncedLeafChangeHandler?: ReturnType<typeof debounce>;
    public isUnloading: boolean = false;

	override async onload() {
        this.isUnloading = false; // Reset the guard flag on every load
		try {
			// The settings object is no longer loaded here.
            // configureServices will handle setting up the initial state.
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

			await manifestManager.initializeDatabase();

			registerViews(this, this.store);
			addRibbonIcon(this, this.store);
			registerCommands(this, this.store);
			registerSystemEventListeners(this, this.store);

            const onLayoutReady = () => {
                // This thunk will now load the correct settings for the active note (or defaults)
                this.store.dispatch(thunks.initializeView(this.app.workspace.activeLeaf));
            };

            if (this.app.workspace.layoutReady) {
                onLayoutReady();
            } else {             
                this.app.workspace.onLayoutReady(onLayoutReady);
            }
			
			this.addStatusBarItem().setText('VC Ready');

		} catch (error) {
			console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = get(error, 'message', "Unknown error during loading");
			new Notice(`Version Control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
            if (this.store) {
                this.store.dispatch(appSlice.actions.reportError({
                    title: "Plugin Load Failed",
                    message: "The Version Control plugin encountered a critical error during loading.",
                    details: message,
                }));
            }
		}
	}

	override async onunload() {
        this.isUnloading = true; // Set the guard flag immediately to halt new operations

        // 1. Cancel any pending debounced operations to prevent them from firing during or after unload.
        this.debouncedLeafChangeHandler?.cancel();

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
}
