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
            // Load settings with enhanced error handling
            const settingsInitializer = new SettingsInitializer(this.plugin);
            await settingsInitializer.loadSettings();

            // Initialize service registry (without store for now)
            const registryInitializer = new ServiceRegistryInitializer(this.plugin);
            const services = registryInitializer.initializeServices();

            // Store reference to service registry
            this.plugin.services = services;

            // Create store with properly loaded settings (NOT in constructor)
            // This ensures state.settings is populated before any UI subscribes
            const initialState = getInitialState(this.plugin.settings);
            services.store = createAppStore(initialState, services);

            // Finalize initialization (update services that depend on store)
            services.finalizeInitialization();

            // Store references to frequently used services
            this.plugin.store = services.store;
            this.plugin.cleanupManager = services.cleanupManager;
            this.plugin.backgroundTaskManager = services.backgroundTaskManager;

            // Subscribe to store changes
            this.plugin.register(this.plugin.store.subscribe(this.plugin.handleStoreChange.bind(this.plugin)));

            // Initialize UI components
            const uiInitializer = new UIInitializer(this.plugin, services.store);
            uiInitializer.registerUIComponents();

            // Initialize core managers (Non-worker dependent)
            services.cleanupManager.initialize();
            
            // NOTE: Worker-dependent managers (Timeline, Compression, EditHistory) are initialized
            // sequentially inside onLayoutReady to prevent main thread freezing during startup.

            // Add child components for automatic cleanup
            this.plugin.addChild(services.cleanupManager);
            this.plugin.addChild(services.uiService);
            this.plugin.addChild(services.diffManager);
            this.plugin.addChild(services.backgroundTaskManager);

            // Initialize database (Manifests only)
            await registryInitializer.initializeDatabase(services);

            // Set up event listeners
            const eventRegistrar = new EventRegistrar(this.plugin, services.store, services.eventBus);
            eventRegistrar.setupEventListeners();

            // Initialize view and workers when layout is ready
            this.plugin.app.workspace.onLayoutReady(async () => {
                if (this.plugin.isUnloading) return;

                // Defer execution to allow the sidebar and layout to stabilize.
                // This prevents UI jank and ensures the view is ready for interaction.
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (this.plugin.isUnloading) return;
                
                // Initialize workers sequentially to prevent UI freeze
                // Priority: Compression -> Edit History -> Timeline -> Diff
                await services.initializeWorkers();

                if (this.plugin.isUnloading) return;

                uiInitializer.initializeView();
                uiInitializer.checkForUpdates();
            });

            this.plugin.setInitialized(true);

        } catch (error) {
            console.error("Version Control: CRITICAL: Plugin failed to load.", error);
            const message = error instanceof Error ? error.message : "Unknown error during loading";
            new Notice(`Version control plugin failed to load. Please check the console for details.\nError: ${message}`, 0);

            // Attempt to report error to store if available
            if (this.plugin.store) {
                this.plugin.store.dispatch(appSlice.actions.reportError({
                    title: "Plugin load failed",
                    message: "The version control plugin encountered a critical error during loading.",
                    details: message,
                }));
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
