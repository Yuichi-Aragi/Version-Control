import type { Container } from 'inversify';
import { configureServices } from '@/inversify.config';
import type { AppStore } from '@/state';
import type { CleanupManager, ManifestManager, BackgroundTaskManager, TimelineManager, CompressionManager, PluginEvents } from '@/core';
import type { UIService, DiffManager } from '@/services';
import { TYPES } from '@/types/inversify.types';
import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Manages dependency injection container setup and service retrieval.
 */
export class ContainerInitializer {
    constructor(private plugin: VersionControlPlugin) {}

    /**
     * Initializes the dependency injection container.
     */
    initializeContainer(): Container {
        // configureServices will use the plugin instance, which now holds the loaded settings.
        const container = configureServices(this.plugin);

        // Validate container initialization
        if (!container) {
            throw new Error("Dependency injection container failed to initialize");
        }

        return container;
    }

    /**
     * Retrieves all required services from the container.
     */
    getServices(container: Container) {
        const store = container.get<AppStore>(TYPES.Store);
        const cleanupManager = container.get<CleanupManager>(TYPES.CleanupManager);
        const uiService = container.get<UIService>(TYPES.UIService);
        const manifestManager = container.get<ManifestManager>(TYPES.ManifestManager);
        const diffManager = container.get<DiffManager>(TYPES.DiffManager);
        const backgroundTaskManager = container.get<BackgroundTaskManager>(TYPES.BackgroundTaskManager);
        const timelineManager = container.get<TimelineManager>(TYPES.TimelineManager);
        const eventBus = container.get<PluginEvents>(TYPES.EventBus);
        const compressionManager = container.get<CompressionManager>(TYPES.CompressionManager);

        // Validate critical services
        if (!store || !cleanupManager || !uiService || !manifestManager ||
            !diffManager || !backgroundTaskManager || !timelineManager || !eventBus || !compressionManager) {
            throw new Error("One or more critical services failed to initialize");
        }

        return {
            store,
            cleanupManager,
            uiService,
            manifestManager,
            diffManager,
            backgroundTaskManager,
            timelineManager,
            eventBus,
            compressionManager
        };
    }

    /**
     * Initializes the database folder structure and loads the central manifest.
     */
    async initializeDatabase(manifestManager: ManifestManager): Promise<void> {
        try {
            // This now initializes the database folder structure (at the configured path)
            // and loads the central manifest from the plugin settings into the repository's cache.
            await manifestManager.initializeDatabase();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error("Version Control: Database initialization failed", error);
            throw new Error(`Database initialization failed: ${errorMessage}`);
        }
    }
}
