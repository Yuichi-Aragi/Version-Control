import VersionControlPlugin from '@/main/VersionControlPlugin';
import { ServiceRegistry } from '@/services-registry';

/**
 * Initializes the service registry for the plugin.
 * This replaces the old container initialization pattern.
 */
export class ServiceRegistryInitializer {
    private readonly plugin: VersionControlPlugin;

    constructor(plugin: VersionControlPlugin) {
        this.plugin = plugin;
    }

    /**
     * Initialize all services and return the service registry.
     */
    initializeServices(): ServiceRegistry {
        return ServiceRegistry.getInstance(this.plugin);
    }

    /**
     * Initialize the database for the plugin.
     */
    async initializeDatabase(services: ServiceRegistry): Promise<void> {
        // Initialize timeline database and load central manifest
        services.timelineDatabase.initialize();
        await services.centralManifestRepo.load(true);
    }
}
