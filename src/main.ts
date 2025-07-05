import { Plugin, Notice } from 'obsidian';
import { DependencyContainer } from './core/dependency-container';
import { Store } from './state/store';
import { actions } from './state/actions';
import { thunks } from './state/thunks/index';
import { VersionControlSettings } from './types';
import { DEFAULT_SETTINGS, SERVICE_NAMES } from './constants';
import { PluginEvents } from './core/plugin-events';
import { CleanupManager } from './core/cleanup-manager';
import { UIService } from './services/ui-service';
import { ManifestManager } from './core/manifest-manager';
import { DiffManager } from './services/diff-manager';
import { BackgroundTaskManager } from './core/BackgroundTaskManager';
import { registerServices } from './setup/ServiceRegistry';
import { registerViews, addRibbonIcon, registerCommands } from './setup/UISetup';
import { registerSystemEventListeners } from './setup/EventSetup';

export default class VersionControlPlugin extends Plugin {
	private container: DependencyContainer;
    private store: Store;
    private cleanupManager: CleanupManager;
    private eventBus: PluginEvents;
    private backgroundTaskManager: BackgroundTaskManager;

	async onload() {
		try {
			const loadedSettings = await this.loadPluginData();
            
            this.container = new DependencyContainer();
            registerServices(this.container, this, loadedSettings);

            // Resolve key services needed for initialization
            this.store = this.container.resolve<Store>(SERVICE_NAMES.STORE);
            this.eventBus = this.container.resolve<PluginEvents>(SERVICE_NAMES.EVENT_BUS);
            this.cleanupManager = this.container.resolve<CleanupManager>(SERVICE_NAMES.CLEANUP_MANAGER);
            const uiService = this.container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
            const manifestManager = this.container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
            const diffManager = this.container.resolve<DiffManager>(SERVICE_NAMES.DIFF_MANAGER);
            this.backgroundTaskManager = this.container.resolve<BackgroundTaskManager>(SERVICE_NAMES.BACKGROUND_TASK_MANAGER);

            // Initialize services that need to register listeners or have a lifecycle
            this.cleanupManager.initialize();
            this.addChild(this.cleanupManager);
            this.addChild(uiService); 
            this.addChild(diffManager);

			await manifestManager.initializeDatabase();

            // Setup UI and event listeners using dedicated modules
			registerViews(this, this.store);
			addRibbonIcon(this, this.store);
			registerCommands(this, this.store);
			registerSystemEventListeners(this, this.store);
			
            // Handle initial view state once layout is ready
            const onLayoutReady = () => {
                this.store.dispatch(thunks.initializeView(this.app.workspace.activeLeaf));
                
                if (this.store.getState().settings.autoCleanupOrphanedVersions) {
                    // Dispatch thunk for initial cleanup instead of calling manager directly
                    this.store.dispatch(thunks.cleanupOrphanedVersions(false));
                }
            };

            if (this.app.workspace.layoutReady) {
                onLayoutReady();
            } else {
                this.app.workspace.onLayoutReady(onLayoutReady);
            }
            
            // Start background tasks
			this.backgroundTaskManager.managePeriodicOrphanCleanup();
            this.backgroundTaskManager.manageWatchModeInterval();
			
			this.addStatusBarItem().setText('VC Ready');
			console.log("Version Control plugin loaded successfully.");

		} catch (error) {
			console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = error instanceof Error ? error.message : "Unknown error during loading";
			new Notice(`Version Control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
            // **FIX M-01:** Add a null check before dispatching to the store.
            // This prevents a secondary error if the store itself failed to initialize.
            if (this.store) {
                this.store.dispatch(actions.reportError({
                    title: "Plugin Load Failed",
                    message: "The Version Control plugin encountered a critical error during loading.",
                    details: message,
                }));
            }
		}
	}

	async onunload() {
        // The `addChild` calls in `onload` handle unloading components like CleanupManager, UIService, etc.
        // We just need to wait for any pending operations to finish gracefully and clear intervals.
        await this.cleanupManager?.completePendingCleanups();
        this.backgroundTaskManager?.clearAllIntervals();
        console.log("Version Control plugin unloaded.");
	}

	async loadPluginData(): Promise<VersionControlSettings> {
		try {
			const loadedData = await this.loadData();
			return Object.assign({}, DEFAULT_SETTINGS, loadedData);
		} catch (error) {
			console.error("Version Control: Could not load settings, using defaults.", error);
			new Notice("Version Control: Could not load settings, using defaults.");
			return { ...DEFAULT_SETTINGS };
		}
	}

    // This method is part of the Plugin class contract for thunks to use.
    async saveData(settings: VersionControlSettings): Promise<void> {
        await super.saveData(settings);
    }
}
