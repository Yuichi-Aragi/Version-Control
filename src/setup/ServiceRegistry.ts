import { App, Plugin } from 'obsidian';
import { DependencyContainer } from '../core/dependency-container';
import { VersionControlSettings } from '../types';
import { SERVICE_NAMES } from '../constants';

// Import all necessary services and managers
import { Store } from '../state/store';
import { getInitialState } from '../state/state';
import { PluginEvents } from '../core/plugin-events';
import { PathService } from '../core/storage/path-service';
import { AtomicFileIO } from '../core/storage/atomic-file-io';
import { WriteQueue } from '../core/storage/write-queue';
import { CentralManifestRepository } from '../core/storage/central-manifest-repository';
import { NoteManifestRepository } from '../core/storage/note-manifest-repository';
import { VersionContentRepository } from '../core/storage/version-content-repository';
import { ManifestManager } from '../core/manifest-manager';
import { NoteManager } from '../core/note-manager';
import { CleanupManager } from '../core/cleanup-manager';
import { VersionManager } from '../core/version-manager';
import { ExportManager } from '../services/export-manager';
import { DiffManager } from '../services/diff-manager';
import { UIService } from '../services/ui-service';
import { BackgroundTaskManager } from '../core/BackgroundTaskManager';
import VersionControlPlugin from '../main';

/**
 * Registers all application services in the dependency container.
 * @param container The dependency injection container.
 * @param plugin The plugin instance.
 * @param globalSettings The loaded global plugin settings from data.json.
 */
export function registerServices(
    container: DependencyContainer, 
    plugin: VersionControlPlugin, 
    globalSettings: VersionControlSettings
): void {
    // Foundational services
    container.register(SERVICE_NAMES.APP, () => plugin.app);
    container.register(SERVICE_NAMES.PLUGIN, () => plugin);
    container.register(SERVICE_NAMES.EVENT_BUS, () => new PluginEvents());
    container.register(SERVICE_NAMES.SETTINGS_PROVIDER, () => {
        // This provides the EFFECTIVE settings from the state for the current context
        return () => container.resolve<Store>(SERVICE_NAMES.STORE).getState().settings;
    });

    // NEW SERVICE to get/save GLOBAL settings
    container.register(SERVICE_NAMES.GLOBAL_SETTINGS_MANAGER, () => ({
        get: () => globalSettings,
        save: async (newSettings: VersionControlSettings) => {
            Object.assign(globalSettings, newSettings); // Update in-memory copy
            await plugin.saveData(globalSettings);
        }
    }));

    // Low-level Storage Services
    container.register(SERVICE_NAMES.PATH_SERVICE, () => new PathService());
    container.register(SERVICE_NAMES.ATOMIC_FILE_IO, (c) => new AtomicFileIO(c.resolve<App>(SERVICE_NAMES.APP).vault));
    container.register(SERVICE_NAMES.WRITE_QUEUE, () => new WriteQueue());
    
    // Repositories
    container.register(SERVICE_NAMES.CENTRAL_MANIFEST_REPO, (c) => new CentralManifestRepository(
        c.resolve(SERVICE_NAMES.ATOMIC_FILE_IO),
        c.resolve(SERVICE_NAMES.PATH_SERVICE),
        c.resolve(SERVICE_NAMES.WRITE_QUEUE)
    ));
    container.register(SERVICE_NAMES.NOTE_MANIFEST_REPO, (c) => new NoteManifestRepository(
        c.resolve(SERVICE_NAMES.ATOMIC_FILE_IO),
        c.resolve(SERVICE_NAMES.PATH_SERVICE),
        c.resolve(SERVICE_NAMES.WRITE_QUEUE)
    ));
    container.register(SERVICE_NAMES.VERSION_CONTENT_REPO, (c) => new VersionContentRepository(
        c.resolve(SERVICE_NAMES.APP),
        c.resolve(SERVICE_NAMES.PATH_SERVICE)
    ));

    // High-level Managers
    container.register(SERVICE_NAMES.MANIFEST_MANAGER, (c) => new ManifestManager(
        c.resolve(SERVICE_NAMES.APP),
        c.resolve(SERVICE_NAMES.PATH_SERVICE),
        c.resolve(SERVICE_NAMES.CENTRAL_MANIFEST_REPO),
        c.resolve(SERVICE_NAMES.NOTE_MANIFEST_REPO)
    ));
    container.register(SERVICE_NAMES.NOTE_MANAGER, (c) => new NoteManager(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.MANIFEST_MANAGER)));
    
    container.register(SERVICE_NAMES.CLEANUP_MANAGER, (c) => new CleanupManager(
        c.resolve(SERVICE_NAMES.APP), 
        c.resolve(SERVICE_NAMES.MANIFEST_MANAGER), 
        c.resolve(SERVICE_NAMES.SETTINGS_PROVIDER),
        c.resolve(SERVICE_NAMES.EVENT_BUS),
        c.resolve(SERVICE_NAMES.PATH_SERVICE)
    ));
    
    container.register(SERVICE_NAMES.VERSION_MANAGER, (c) => new VersionManager(
        c.resolve(SERVICE_NAMES.APP), 
        c.resolve(SERVICE_NAMES.MANIFEST_MANAGER), 
        c.resolve(SERVICE_NAMES.NOTE_MANAGER), 
        c.resolve(SERVICE_NAMES.VERSION_CONTENT_REPO),
        c.resolve(SERVICE_NAMES.EVENT_BUS)
    ));
    
    // Other Services
    container.register(SERVICE_NAMES.EXPORT_MANAGER, (c) => new ExportManager(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.VERSION_MANAGER)));
    
    container.register(SERVICE_NAMES.DIFF_MANAGER, (c) => new DiffManager(
        c.resolve(SERVICE_NAMES.APP), 
        c.resolve(SERVICE_NAMES.VERSION_MANAGER),
        c.resolve(SERVICE_NAMES.EVENT_BUS)
    ));
    
    container.register(SERVICE_NAMES.UI_SERVICE, (c) => new UIService(c.resolve(SERVICE_NAMES.APP), c.resolve(SERVICE_NAMES.STORE)));

    container.register(SERVICE_NAMES.BACKGROUND_TASK_MANAGER, (c) => new BackgroundTaskManager(c.resolve(SERVICE_NAMES.STORE)));

    // Store (must be last to get all dependencies)
    container.register(SERVICE_NAMES.STORE, (c) => {
        const initialState = getInitialState(globalSettings); // Initialize with global settings
        return new Store(initialState, c);
    });
}
