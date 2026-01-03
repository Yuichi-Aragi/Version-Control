import type { App } from 'obsidian';
import type VersionControlPlugin from '@/main/VersionControlPlugin';
import type { AppStore } from '@/state';

// Import implementations
import { PluginEvents } from '@/core/plugin-events';
import { QueueService } from '@/services/queue-service';
import { PathService } from '@/core/storage/path-service';
import { StorageService } from '@/core/storage/storage-service';
import { CentralManifestRepository } from '@/core/storage/central-manifest-repository';
import { NoteManifestRepository } from '@/core/storage/note-manifest-repository';
import { VersionContentRepository } from '@/core/storage/version-content-repository';
import { TimelineDatabase } from '@/core/storage/timeline-database';
import { ManifestManager } from '@/core/manifest-manager';
import { NoteManager } from '@/core/note-manager';
import { VersionManager } from '@/core/version-manager/VersionManager';
import { TimelineManager } from '@/core/timeline-manager';
import { EditHistoryManager } from '@/core/edit-history-manager/EditHistoryManager';
import { CompressionManager } from '@/core/compression-manager';
import { CleanupManager } from '@/core/tasks/cleanup-manager/CleanupManager';
import { BackgroundTaskManager } from '@/core/tasks/BackgroundTaskManager';
import { ExportManager } from '@/services/export-manager';
import { DiffManager } from '@/services/diff-manager/DiffManager';
import { UIService } from '@/services/ui-service';

/**
 * Service registry that provides access to all singleton services.
 * This replaces the inversify dependency injection container.
 * Services are instantiated once and stored for the lifetime of the plugin.
 */
export class ServiceRegistry {
    private static instance: ServiceRegistry | null = null;

    // Core & Constant Services
    public readonly plugin: VersionControlPlugin;
    public readonly app: App;

    // Event Bus
    public readonly eventBus: PluginEvents;

    // Queue Service
    public readonly queueService: QueueService;

    // Low-level Storage Services
    public readonly pathService: PathService;
    public readonly storageService: StorageService;

    // Repositories
    public readonly centralManifestRepo: CentralManifestRepository;
    public readonly noteManifestRepo: NoteManifestRepository;
    public readonly versionContentRepo: VersionContentRepository;
    public readonly timelineDatabase: TimelineDatabase;

    // High-level Managers
    public readonly manifestManager: ManifestManager;
    public readonly noteManager: NoteManager;
    public readonly versionManager: VersionManager;
    public readonly timelineManager: TimelineManager;
    public readonly editHistoryManager: EditHistoryManager;
    public readonly compressionManager: CompressionManager;

    // Task Managers (reassigned in finalizeInitialization)
    public cleanupManager!: CleanupManager;
    public backgroundTaskManager!: BackgroundTaskManager;

    // Other Services
    public readonly exportManager: ExportManager;
    public readonly diffManager: DiffManager;
    public uiService!: UIService;

    // Store (assigned after construction to ensure settings are loaded)
    public store!: AppStore;

    constructor(plugin: VersionControlPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;

        // Initialize core services first (services with no dependencies)
        this.eventBus = new PluginEvents();
        this.queueService = new QueueService();
        this.pathService = new PathService(plugin);
        this.storageService = new StorageService(this.app);

        // Initialize compression manager early (used by other services)
        // Note: Worker initialization is deferred to initializeWorkers()
        this.compressionManager = new CompressionManager();

        // Initialize repositories
        this.centralManifestRepo = new CentralManifestRepository(plugin, this.queueService);
        this.noteManifestRepo = new NoteManifestRepository(this.app, this.pathService, this.queueService, this.storageService);
        this.versionContentRepo = new VersionContentRepository(this.app, plugin, this.pathService, this.queueService, this.compressionManager, this.storageService);
        this.timelineDatabase = new TimelineDatabase();

        // Initialize managers (in dependency order)
        this.manifestManager = new ManifestManager(
            this.pathService,
            this.storageService,
            this.centralManifestRepo,
            this.noteManifestRepo
        );

        this.editHistoryManager = new EditHistoryManager(
            this.app, 
            this.plugin,
            this.pathService,
            this.queueService
        );

        this.noteManager = new NoteManager(
            plugin,
            this.app,
            this.manifestManager,
            this.editHistoryManager,
            this.eventBus
        );

        this.versionManager = new VersionManager(
            plugin,
            this.app,
            this.manifestManager,
            this.noteManager,
            this.versionContentRepo,
            this.eventBus,
            this.queueService,
            this.editHistoryManager // Injected here
        );

        this.diffManager = new DiffManager(
            this.app,
            this.versionManager,
            this.versionContentRepo,
            this.eventBus
        );

        this.timelineManager = new TimelineManager(
            this.timelineDatabase,
            this.diffManager,
            this.versionManager,
            this.editHistoryManager,
            this.versionContentRepo,
            this.eventBus
        );

        // Initialize with placeholder stores - will be updated after store creation
        this.cleanupManager = new CleanupManager(
            this.app,
            this.manifestManager,
            this.editHistoryManager,
            this.eventBus,
            this.pathService,
            this.queueService,
            this.versionContentRepo,
            plugin,
            this.storageService,
            {} as AppStore,
            this.noteManager
        );

        this.backgroundTaskManager = new BackgroundTaskManager(
            {} as AppStore,
            this.manifestManager,
            this.editHistoryManager,
            plugin
        );

        this.exportManager = new ExportManager(
            this.app,
            this.versionManager,
            this.editHistoryManager,
            this.compressionManager
        );

        this.uiService = new UIService(this.app, {} as AppStore);

        // Store is NOT created here - it's created in plugin-loader.ts after settings are loaded
        // This ensures state.settings is properly populated before any UI subscribes
    }

    /**
     * Finalizes initialization after the store is created.
     * Updates services that depend on the store.
     */
    finalizeInitialization(): void {
        // Now update services that depend on the store
        this.cleanupManager = new CleanupManager(
            this.app,
            this.manifestManager,
            this.editHistoryManager,
            this.eventBus,
            this.pathService,
            this.queueService,
            this.versionContentRepo,
            this.plugin,
            this.storageService,
            this.store,
            this.noteManager
        );

        this.backgroundTaskManager = new BackgroundTaskManager(
            this.store,
            this.manifestManager,
            this.editHistoryManager,
            this.plugin
        );

        this.uiService = new UIService(this.app, this.store);
    }

    /**
     * Get all services as a simple object for backward compatibility.
     * @deprecated Use direct service access from registry instance instead.
     */
    getAllServices() {
        return {
            store: this.store,
            cleanupManager: this.cleanupManager,
            uiService: this.uiService,
            manifestManager: this.manifestManager,
            diffManager: this.diffManager,
            backgroundTaskManager: this.backgroundTaskManager,
            timelineManager: this.timelineManager,
            eventBus: this.eventBus,
            compressionManager: this.compressionManager,
            versionManager: this.versionManager,
            noteManager: this.noteManager,
            editHistoryManager: this.editHistoryManager,
            pathService: this.pathService,
            storageService: this.storageService,
            centralManifestRepo: this.centralManifestRepo,
            noteManifestRepo: this.noteManifestRepo,
            versionContentRepo: this.versionContentRepo,
            timelineDatabase: this.timelineDatabase,
            queueService: this.queueService,
            exportManager: this.exportManager,
            plugin: this.plugin,
            app: this.app,
        };
    }

    /**
     * Initializes all workers sequentially with a delay to prevent main thread freezing.
     * Priority: Compression -> Edit History -> Timeline -> Diff
     * This should be called inside onLayoutReady.
     */
    async initializeWorkers(): Promise<void> {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        if (this.plugin.isUnloading) return;

        // 1. Compression Worker (Highest Priority - used by other services)
        if (this.compressionManager) {
            this.compressionManager.initialize();
        }
        await delay(100);

        if (this.plugin.isUnloading) return;

        // 2. Edit History Worker (High Priority - data integrity)
        if (this.editHistoryManager) {
            this.editHistoryManager.initialize();
        }
        await delay(100);

        if (this.plugin.isUnloading) return;

        // 3. Timeline Worker (UI Priority)
        // Note: TimelineManager.initialize() calls timelineDatabase.initialize()
        if (this.timelineManager) {
            this.timelineManager.initialize();
        }
        await delay(100);                
    }

    /**
     * Initialize all services that require initialization.
     * @deprecated Use initializeWorkers() inside onLayoutReady instead.
     */
    async initializeAll(): Promise<void> {
        // Redirect to new method for backward compatibility, though this loses the benefit of onLayoutReady
        // if called synchronously.
        await this.initializeWorkers();
    }

    /**
     * Clean up all services on plugin unload.
     */
    async cleanupAll(): Promise<void> {
        // Invalidate caches and clear all pending task queues
        this.centralManifestRepo.invalidateCache();
        this.noteManifestRepo.clearCache();
        this.queueService.clearAll();

        // Terminate workers
        await this.editHistoryManager.terminate();
        this.compressionManager.terminate();
        this.timelineDatabase.terminate();
    }

    /**
     * Get the singleton instance of the service registry.
     */
    static getInstance(plugin?: VersionControlPlugin): ServiceRegistry {
        if (!this.instance && plugin) {
            this.instance = new ServiceRegistry(plugin);
        }
        if (!this.instance) {
            throw new Error('ServiceRegistry not initialized. Call getInstance with a plugin first.');
        }
        return this.instance;
    }

    /**
     * Reset the singleton instance (mainly for testing).
     */
    static resetInstance(): void {
        this.instance = null;
    }
}

/**
 * Type for services object passed to Redux thunks.
 * This replaces the Container type that was used with inversify.
 */
export type Services = ServiceRegistry;
