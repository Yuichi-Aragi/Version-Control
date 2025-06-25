import { Plugin, TFile, WorkspaceLeaf, debounce, Notice, MetadataCache, MarkdownView, App } from 'obsidian';
import { ManifestManager } from './core/manifest-manager';
import { VersionManager } from './core/version-manager';
import { NoteManager } from './core/note-manager';
import { CleanupManager } from './core/cleanup-manager';
import { ExportManager } from './services/export-manager';
import { DiffManager } from './services/diff-manager';
import { UIService } from './services/ui-service';
import { VersionControlView } from './ui/version-control-view';
import { VersionPreviewView } from './ui/version-preview-view';
import { VersionDiffView } from './ui/version-diff-view';
import { VersionControlSettings } from './types';
import { VIEW_TYPE_VERSION_CONTROL, DEFAULT_SETTINGS, VIEW_TYPE_VERSION_PREVIEW, VIEW_TYPE_VERSION_DIFF, SERVICE_NAMES } from './constants';
import { Store } from './state/store';
import { getInitialState } from './state/state';
import { thunks } from './state/thunks/index';
import { actions } from './state/actions';
import { DependencyContainer } from './core/dependency-container';
import { PluginEvents } from './core/plugin-events';
import { AppStatus } from './state/state';

export default class VersionControlPlugin extends Plugin {
	private container: DependencyContainer;
    private store: Store; // Keep a direct reference for convenience
    private cleanupManager: CleanupManager; // Keep for onunload
    private uiService: UIService; // Keep for onunload
    private eventBus: PluginEvents; // Keep for onunload

    private periodicOrphanCleanupInterval: number | null = null;
    private readonly ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    private watchModeIntervalId: number | null = null;

	async onload() {
		try {
			const loadedSettings = await this.loadPluginData();
            
            this.container = new DependencyContainer();
            this.registerServices(loadedSettings);

            // Resolve key services needed for initialization
            this.store = this.container.resolve<Store>(SERVICE_NAMES.STORE);
            this.eventBus = this.container.resolve<PluginEvents>(SERVICE_NAMES.EVENT_BUS);
            this.cleanupManager = this.container.resolve<CleanupManager>(SERVICE_NAMES.CLEANUP_MANAGER);
            this.uiService = this.container.resolve<UIService>(SERVICE_NAMES.UI_SERVICE);
            const manifestManager = this.container.resolve<ManifestManager>(SERVICE_NAMES.MANIFEST_MANAGER);
            const diffManager = this.container.resolve<DiffManager>(SERVICE_NAMES.DIFF_MANAGER);

            // Initialize services that need to register listeners
            this.cleanupManager.initialize();

            // Add services with lifecycles as children for automatic management
            this.addChild(this.uiService); 
            this.addChild(diffManager);

			await manifestManager.initializeDatabase();

			this.registerView(
				VIEW_TYPE_VERSION_CONTROL,
				(leaf) => new VersionControlView(leaf, this.store, this.app)
			);
			this.registerView(
                VIEW_TYPE_VERSION_PREVIEW,
                (leaf) => new VersionPreviewView(leaf, this.store, this.app)
            );
            this.registerView(
                VIEW_TYPE_VERSION_DIFF,
                (leaf) => new VersionDiffView(leaf, this.store, this.app)
            );

			this.addRibbonIcon('history', 'Open Version Control', () => this.activateViewAndDispatch());
			this.addCommands();
			
			this.registerPluginEvents();
			
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
            
			this.managePeriodicOrphanCleanup();
            this.manageWatchModeInterval();
			
			this.addStatusBarItem().setText('VC Ready');
			console.log("Version Control plugin loaded successfully. DI container initialized.");

		} catch (error) {
			console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = error instanceof Error ? error.message : "Unknown error during loading";
			new Notice(`Version Control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);
            if (this.store) {
                this.store.dispatch(actions.reportError({
                    title: "Plugin Load Failed",
                    message: "The Version Control plugin encountered a critical error during loading.",
                    details: message,
                }));
            }
		}
	}

    private registerServices(loadedSettings: VersionControlSettings): void {
        const c = this.container;

        // Core services
        c.register(SERVICE_NAMES.APP, () => this.app);
        c.register(SERVICE_NAMES.PLUGIN, () => this);
        c.register(SERVICE_NAMES.SETTINGS_PROVIDER, () => {
            return () => c.resolve<Store>(SERVICE_NAMES.STORE).getState().settings;
        });

        // New Event Bus Service
        c.register(SERVICE_NAMES.EVENT_BUS, () => new PluginEvents());

        // Managers
        c.register(SERVICE_NAMES.MANIFEST_MANAGER, (c) => new ManifestManager(c.resolve(SERVICE_NAMES.APP)));
        c.register(SERVICE_NAMES.NOTE_MANAGER, (c) => new NoteManager(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.MANIFEST_MANAGER)));
        
        // CleanupManager now depends on the event bus to listen for events
        c.register(SERVICE_NAMES.CLEANUP_MANAGER, (c) => new CleanupManager(
            c.resolve(SERVICE_NAMES.APP), 
            c.resolve(SERVICE_NAMES.MANIFEST_MANAGER), 
            c.resolve(SERVICE_NAMES.SETTINGS_PROVIDER),
            c.resolve(SERVICE_NAMES.EVENT_BUS)
        ));
        
        // VersionManager now depends on the event bus to emit events
        c.register(SERVICE_NAMES.VERSION_MANAGER, (c) => new VersionManager(
            c.resolve(SERVICE_NAMES.APP), 
            c.resolve(SERVICE_NAMES.MANIFEST_MANAGER), 
            c.resolve(SERVICE_NAMES.NOTE_MANAGER), 
            c.resolve(SERVICE_NAMES.EVENT_BUS)
        ));
        
        c.register(SERVICE_NAMES.EXPORT_MANAGER, (c) => new ExportManager(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.VERSION_MANAGER)));
        
        // DiffManager is now a listening service that depends on the event bus
        c.register(SERVICE_NAMES.DIFF_MANAGER, (c) => new DiffManager(
            c.resolve(SERVICE_NAMES.APP), 
            c.resolve(SERVICE_NAMES.VERSION_MANAGER),
            c.resolve(SERVICE_NAMES.EVENT_BUS)
        ));
        
        // UI Service
        c.register(SERVICE_NAMES.UI_SERVICE, (c) => new UIService(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.STORE)));

        // Store
        c.register(SERVICE_NAMES.STORE, (c) => {
            const initialState = getInitialState(loadedSettings);
            // The Store is now constructed with the DI container itself,
            // allowing thunks to resolve their own dependencies.
            const store = new Store(initialState, c);
            return store;
        });
    }

	async onunload() {
        await this.cleanupManager?.completePendingCleanups();
        // Unregister all event listeners associated with the cleanupManager instance
        this.eventBus?.offref(this.cleanupManager);
        this.cleanupIntervals();
        if (this.watchModeIntervalId) {
            window.clearInterval(this.watchModeIntervalId);
            this.watchModeIntervalId = null;
        }
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

    async saveData(settings: VersionControlSettings): Promise<void> {
        await super.saveData(settings);
    }

    public managePeriodicOrphanCleanup(): void {
        this.cleanupIntervals(); 

        if (this.store.getState().settings.autoCleanupOrphanedVersions) {
            // Initial cleanup after a delay
            setTimeout(() => this.store.dispatch(thunks.cleanupOrphanedVersions(false)), 5 * 60 * 1000);

            this.periodicOrphanCleanupInterval = window.setInterval(() => {
                this.store.dispatch(thunks.cleanupOrphanedVersions(false));
            }, this.ORPHAN_CLEANUP_INTERVAL_MS);
            console.log("Version Control: Periodic orphaned version cleanup scheduled.");
        } else {
            console.log("Version Control: Periodic orphaned version cleanup is disabled.");
        }
    }

    public manageWatchModeInterval(): void {
        if (this.watchModeIntervalId) {
            window.clearInterval(this.watchModeIntervalId);
            this.watchModeIntervalId = null;
        }

        const state = this.store.getState();
        const settings = state.settings;

        if (!settings.enableWatchMode) {
            return;
        }

        // Only start the interval if the view is ready for a note.
        // The interval callback will perform its own checks before saving.
        if (state.status === AppStatus.READY) {
            const intervalMs = settings.watchModeInterval * 1000;
            
            this.watchModeIntervalId = window.setInterval(() => {
                const currentState = this.store.getState();
                // Only run if the view is still ready for the same file and not busy
                if (currentState.status === AppStatus.READY && !currentState.isProcessing) {
                    this.store.dispatch(thunks.saveNewVersion({ isAuto: true }));
                }
            }, intervalMs);
            console.log(`Version Control: Watch mode timer started with ${settings.watchModeInterval}s interval.`);
        }
    }

    private cleanupIntervals(): void {
        if (this.periodicOrphanCleanupInterval !== null) {
            window.clearInterval(this.periodicOrphanCleanupInterval);
            this.periodicOrphanCleanupInterval = null;
            console.log("Version Control: Periodic cleanup interval cleared.");
        }
    }

	private addCommands() {
		this.addCommand({
			id: 'open-version-control-view',
			name: 'Open Version Control View',
			callback: () => this.activateViewAndDispatch(),
		});

		this.addCommand({
			id: 'save-new-version',
			name: 'Save a new version of the current note',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === 'md') {
					if (!checking) {
                        this.store.dispatch(thunks.saveNewVersion());
					}
					return true;
				}
				return false;
			}
		});

        this.addCommand({
            id: 'cleanup-orphaned-versions',
            name: 'Clean up orphaned version data',
            callback: () => {
                this.store.dispatch(thunks.cleanupOrphanedVersions(true));
            },
        });
	}

	private registerPluginEvents() {
		const debouncedLeafChangeHandler = debounce((leaf: WorkspaceLeaf | null) => {
            this.store.dispatch(thunks.initializeView(leaf));
        }, 100, false);

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            const view = leaf?.view;
            if (view?.getViewType() === VIEW_TYPE_VERSION_CONTROL || view?.getViewType() === VIEW_TYPE_VERSION_PREVIEW || view?.getViewType() === VIEW_TYPE_VERSION_DIFF) {
                return; 
            }
            debouncedLeafChangeHandler(leaf);
        }));
        
        this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
            this.store.dispatch(thunks.handleMetadataChange(file, cache));
        }));

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) {
                this.store.dispatch(thunks.handleFileRename(file, oldPath));
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile) {
                this.store.dispatch(thunks.handleFileDelete(file));
            }
        }));
	}

	async activateViewAndDispatch() {
        let contextLeaf: WorkspaceLeaf | null = null;
        const currentActiveLeaf = this.app.workspace.activeLeaf;

        if (currentActiveLeaf && currentActiveLeaf.view instanceof MarkdownView) {
            const mdView = currentActiveLeaf.view as MarkdownView;
            if (mdView.file && mdView.file.extension === 'md') {
                contextLeaf = currentActiveLeaf;
            }
        }
        
        this.store.dispatch(thunks.initializeView(contextLeaf));

        const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
        if (existingLeaves.length > 0) {
            this.app.workspace.revealLeaf(existingLeaves[0]);
        } else {
            const newLeaf = this.app.workspace.getRightLeaf(false);
            if (newLeaf) {
                await newLeaf.setViewState({
                    type: VIEW_TYPE_VERSION_CONTROL,
                    active: true,
                });
                this.app.workspace.revealLeaf(newLeaf);
            } else {
                console.error("Version Control: Could not get a leaf to activate the view.");
                this.uiService.showNotice("Error: Could not open Version Control view.", 7000);
            }
        }
	}
}
