import { Container } from 'inversify';
import type { App } from 'obsidian';
import { TYPES } from './types/inversify.types';
import type { VersionControlSettings } from './types';
import type VersionControlPlugin from './main';
import { createAppStore, type AppStore } from './state/store';
import { getInitialState } from './state/state';
import { PluginEvents } from './core/plugin-events';
import { PathService } from './core/storage/path-service';
import { AtomicFileIO } from './core/storage/atomic-file-io';
import { QueueService } from './services/queue-service';
import { CentralManifestRepository } from './core/storage/central-manifest-repository';
import { NoteManifestRepository } from './core/storage/note-manifest-repository';
import { VersionContentRepository } from './core/storage/version-content-repository';
import { ManifestManager } from './core/manifest-manager';
import { NoteManager } from './core/note-manager';
import { CleanupManager } from './core/cleanup-manager';
import { VersionManager } from './core/version-manager';
import { ExportManager } from './services/export-manager';
import { DiffManager } from './services/diff-manager';
import { UIService } from './services/ui-service';
import { BackgroundTaskManager } from './core/BackgroundTaskManager';
import { DEFAULT_SETTINGS } from './constants';

// FIX: The function no longer accepts globalSettings.
export function configureServices(plugin: VersionControlPlugin): Container {
    const container = new Container({
        // Inversify v7+ recommends defaultScope: 'Singleton' for performance
        // if most of your services are singletons.
        defaultScope: 'Singleton'
    });

    // == CORE & CONSTANT BINDINGS ==
    container.bind<VersionControlPlugin>(TYPES.Plugin).toConstantValue(plugin);
    container.bind<App>(TYPES.App).toConstantValue(plugin.app);
    container.bind<Container>(TYPES.Container).toConstantValue(container);

    // == SETTINGS PROVIDERS ==
    // Provider for EFFECTIVE settings (can be global or per-note)
    container.bind<() => VersionControlSettings>(TYPES.SettingsProvider).toFactory(() => {
        return () => {
            // This factory ensures the latest settings are always retrieved from the store.
            // This part remains correct.
            const store = container.get<AppStore>(TYPES.Store);
            return store.getState().settings;
        };
    });

    // FIX: The GlobalSettingsManager is removed as settings are no longer in data.json.

    // == SINGLETON CLASS BINDINGS ==
    // Foundational services
    container.bind<PluginEvents>(TYPES.EventBus).to(PluginEvents);
    container.bind<QueueService>(TYPES.QueueService).to(QueueService);

    // Low-level Storage Services
    container.bind<PathService>(TYPES.PathService).to(PathService);
    container.bind<AtomicFileIO>(TYPES.AtomicFileIO).to(AtomicFileIO);
    
    // Repositories
    container.bind<CentralManifestRepository>(TYPES.CentralManifestRepo).to(CentralManifestRepository);
    container.bind<NoteManifestRepository>(TYPES.NoteManifestRepo).to(NoteManifestRepository);
    container.bind<VersionContentRepository>(TYPES.VersionContentRepo).to(VersionContentRepository);

    // High-level Managers
    container.bind<ManifestManager>(TYPES.ManifestManager).to(ManifestManager);
    container.bind<NoteManager>(TYPES.NoteManager).to(NoteManager);
    container.bind<CleanupManager>(TYPES.CleanupManager).to(CleanupManager);
    container.bind<VersionManager>(TYPES.VersionManager).to(VersionManager);
    
    // Other Services
    container.bind<ExportManager>(TYPES.ExportManager).to(ExportManager);
    container.bind<DiffManager>(TYPES.DiffManager).to(DiffManager);
    container.bind<UIService>(TYPES.UIService).to(UIService);
    container.bind<BackgroundTaskManager>(TYPES.BackgroundTaskManager).to(BackgroundTaskManager);

    // == STORE BINDING (MUST BE LAST) ==
    // The store needs access to the container for its thunks' `extraArgument`.
    // We use `toDynamicValue` to defer the store's creation until it's requested,
    // by which point all other services have been bound. `toDynamicValue` is
    // executed only once for singletons, caching the result.
    container.bind<AppStore>(TYPES.Store).toDynamicValue(() => {
        // FIX: The initial state is now created from the hardcoded DEFAULT_SETTINGS.
        // Effective settings for the active note will be loaded via a thunk after initialization.
        const initialState = getInitialState(DEFAULT_SETTINGS);
        // The container is passed to the store factory, which configures it as middleware extraArgument.
        // Use the 'container' instance from the closure, which has the concrete `Container` type.
        return createAppStore(initialState, container);
    });

    return container;
}
