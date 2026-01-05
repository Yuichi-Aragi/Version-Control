import { Notice } from 'obsidian';
import { appSlice, getInitialState } from '@/state';
import { SettingsInitializer, ServiceRegistryInitializer, UIInitializer } from '@/main/initialization';
import { EventRegistrar } from '@/main/events';
import type VersionControlPlugin from '@/main/VersionControlPlugin';
import { createAppStore } from '@/state';

/**
 * Handles plugin loading lifecycle.
 */
export class PluginLoader {
    constructor(private plugin: VersionControlPlugin) {}

    /**
     * Performs complete plugin loading sequence.
     */
    async load(): Promise<void> {
        // Prevent multiple initialization attempts
        if (this.plugin.initialized) {
            console.warn("Version Control: Plugin already initialized, skipping onload");
            return;
        }

        this.plugin.isUnloading = false; // Reset the guard flag on every load
        this.plugin.queuedChangelogRequest = null; // Reset queue on every load

        try {
            // 1. Load settings with enhanced error handling
            const settingsInitializer = new SettingsInitializer(this.plugin);
            await settingsInitializer.loadSettings();
            
            if (this.plugin.isUnloading) return;

            // 2. Initialize service registry (without store for now)
            const registryInitializer = new ServiceRegistryInitializer(this.plugin);
            const services = registryInitializer.initializeServices();

            // Store reference to service registry
            this.plugin.services = services;

            // 3. Create store with properly loaded settings
            const initialState = getInitialState(this.plugin.settings);
            services.store = createAppStore(initialState, services);

            // 4. Finalize initialization (update services that depend on store)
            services.finalizeInitialization();

            // Store references to frequently used services
            this.plugin.store = services.store;
            this.plugin.cleanupManager = services.cleanupManager;
            this.plugin.backgroundTaskManager = services.backgroundTaskManager;

            // Subscribe to store changes
            this.plugin.register(this.plugin.store.subscribe(this.plugin.handleStoreChange.bind(this.plugin)));

            // 5. Initialize UI components
            const uiInitializer = new UIInitializer(this.plugin, services.store);
            uiInitializer.registerUIComponents();

            // 6. Initialize core managers (Non-worker dependent)
            try {
                services.cleanupManager.initialize();
            } catch (e) {
                console.error("Version Control: Cleanup manager failed to initialize (non-fatal)", e);
            }
            
            // Add child components for automatic cleanup
            this.plugin.addChild(services.cleanupManager);
            this.plugin.addChild(services.uiService);
            this.plugin.addChild(services.diffManager);
            this.plugin.addChild(services.backgroundTaskManager);

            // 7. Initialize database (Manifests only)
            await registryInitializer.initializeDatabase(services);

            // 8. Set up event listeners
            const eventRegistrar = new EventRegistrar(this.plugin, services.store, services.eventBus);
            eventRegistrar.setupEventListeners();

            // 9. Initialize view and workers when layout is ready
            // We use onLayoutReady without a timeout to ensure Obsidian is fully initialized.
            this.plugin.app.workspace.onLayoutReady(() => {
                if (this.plugin.isUnloading) return;

                // PERF: Use requestIdleCallback to defer heavy initialization.
                // This allows the main thread to handle immediate UI rendering (like sidebar animations)
                // before we consume resources for worker startup and view hydration.
                // We provide a timeout to ensure it runs eventually even if the browser is busy.
                const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
                
                defer(async () => {
                    if (this.plugin.isUnloading) return;
                    
                    // Initialize workers sequentially to prevent UI freeze
                    // Priority: Compression -> Edit History -> Timeline -> Diff
                    try {
                        await services.initializeWorkers();
                    } catch (e) {
                        console.error("Version Control: Worker initialization failed (partial)", e);
                        // We continue, as some features might still work
                    }

                    if (this.plugin.isUnloading) return;

                    // Attempt to initialize view, but don't crash if it fails
                    try {
                        uiInitializer.initializeView();
                    } catch (e) {
                        console.warn("Version Control: View initialization deferred/failed (non-fatal)", e);
                    }

                    uiInitializer.checkForUpdates();
                }, { timeout: 2000 }); // Force execution within 2s
            });

            this.plugin.setInitialized(true);

        } catch (error) {
            console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = error instanceof Error ? error.message : "Unknown error during loading";
            
            // Only show notice if we really can't recover
            new Notice(`Version control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);

            // Attempt to report error to store if available
            if (this.plugin.store) {
                try {
                    this.plugin.store.dispatch(appSlice.actions.reportError({
                        title: "Plugin load failed",
                        message: "The version control plugin encountered a critical error during loading.",
                        details: message,
                    }));
                } catch (e) { /* Ignore store dispatch errors during crash */ }
            }

            // Ensure cleanup if initialization fails
            await this.performEmergencyCleanup();
        }
    }

    /**
     * Performs emergency cleanup if initialization fails.
     */
    private async performEmergencyCleanup(): Promise<void> {
        try {
            this.plugin.cancelDebouncedOperations();
            await this.plugin.completePendingOperations();
            await this.plugin.cleanupServices();
        } catch (error) {
            console.error("Version Control: Emergency cleanup failed", error);
        }
    }
}
