import 'reflect-metadata'; // Must be the first import
import { Plugin, Notice } from 'obsidian';
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

export default class VersionControlPlugin extends Plugin {
	private container!: Container;
    private store!: AppStore;
    private cleanupManager!: CleanupManager;
    private backgroundTaskManager!: BackgroundTaskManager;

	override async onload() {
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
        await this.cleanupManager?.completePendingCleanups();
	}

	// This method is no longer used for settings. It's kept for future plugin-wide data.
	async loadPluginData(): Promise<any> {
		return (await this.loadData()) || {};
	}

    // This method is no longer used for settings. It's kept for future plugin-wide data.
    override async saveData(data: any): Promise<void> {
        await super.saveData(data);
    }
}
