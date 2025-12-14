import { Notice } from 'obsidian';
import { appSlice } from '@/state';
import { SettingsInitializer, ContainerInitializer, UIInitializer } from '@/main/initialization';
import { EventRegistrar } from '@/main/events';
import type VersionControlPlugin from '@/main/VersionControlPlugin';

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

            // Initialize dependency injection container
            const containerInitializer = new ContainerInitializer(this.plugin);
            this.plugin.container = containerInitializer.initializeContainer();

            // Get all services from container
            const services = containerInitializer.getServices(this.plugin.container);

            // Store references to frequently used services
            this.plugin.store = services.store;
            this.plugin.cleanupManager = services.cleanupManager;
            this.plugin.backgroundTaskManager = services.backgroundTaskManager;

            // Subscribe to store changes
            this.plugin.register(this.plugin.store.subscribe(this.plugin.handleStoreChange.bind(this.plugin)));

            // Initialize UI components
            const uiInitializer = new UIInitializer(this.plugin, services.store);
            uiInitializer.registerUIComponents();

            // Initialize core managers
            services.cleanupManager.initialize();
            services.timelineManager.initialize();
            services.compressionManager.initialize();

            // Add child components for automatic cleanup
            this.plugin.addChild(services.cleanupManager);
            this.plugin.addChild(services.uiService);
            this.plugin.addChild(services.diffManager);
            this.plugin.addChild(services.backgroundTaskManager);

            // Initialize database
            await containerInitializer.initializeDatabase(services.manifestManager);

            // Set up event listeners
            const eventRegistrar = new EventRegistrar(this.plugin, services.store, services.eventBus);
            eventRegistrar.setupEventListeners();

            // Initialize view when layout is ready
            this.plugin.app.workspace.onLayoutReady(() => {
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
            await this.plugin.cleanupContainer();
        } catch (error) {
            console.error("Version Control: Emergency cleanup failed", error);
        }
    }
}
