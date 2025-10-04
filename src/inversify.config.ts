import { Container } from 'inversify';
import type { App } from 'obsidian';
import { TYPES } from './types/inversify.types';
import type VersionControlPlugin from './main';
import { createAppStore, type AppStore } from './state/store';
import { getInitialState } from './state/state';
import { PluginEvents } from './core/plugin-events';
import { PathService } from './core/storage/path-service';
import { QueueService } from './services/queue-service';
import { CentralManifestRepository } from './core/storage/central-manifest-repository';
import { NoteManifestRepository } from './core/storage/note-manifest-repository';
import { VersionContentRepository } from './core/storage/version-content-repository';
import { ManifestManager } from './core/manifest-manager';
import { NoteManager } from './core/note-manager';
import { CleanupManager } from './core/tasks/cleanup-manager';
import { VersionManager } from './core/version-manager';
import { ExportManager } from './services/export-manager';
import { DiffManager } from './services/diff-manager';
import { UIService } from './services/ui-service';
import { BackgroundTaskManager } from './core/tasks/BackgroundTaskManager';
import { StorageService } from './core/storage/storage-service';
import { KeyUpdateManager } from './core/tasks/KeyUpdateManager';

export function configureServices(plugin: VersionControlPlugin): Container {
  const container = new Container({
        defaultScope: 'Singleton',
  });

  // == CORE & CONSTANT BINDINGS ==
  container.bind<VersionControlPlugin>(TYPES.Plugin).toConstantValue(plugin);
  container.bind<App>(TYPES.App).toConstantValue(plugin.app);
  container.bind<Container>(TYPES.Container).toConstantValue(container);

  // == SINGLETON CLASS BINDINGS ==
  // Foundational services
  container.bind<PluginEvents>(TYPES.EventBus).to(PluginEvents);
  container.bind<QueueService>(TYPES.QueueService).to(QueueService);
  // Low-level Storage Services
  container.bind<PathService>(TYPES.PathService).to(PathService);
  container.bind<StorageService>(TYPES.StorageService).to(StorageService);
  // Repositories
  container.bind<CentralManifestRepository>(TYPES.CentralManifestRepo).to(CentralManifestRepository);
  container.bind<NoteManifestRepository>(TYPES.NoteManifestRepo).to(NoteManifestRepository);
  container.bind<VersionContentRepository>(TYPES.VersionContentRepo).to(VersionContentRepository);
  // High-level Managers
  container.bind<ManifestManager>(TYPES.ManifestManager).to(ManifestManager);
  container.bind<NoteManager>(TYPES.NoteManager).to(NoteManager);
  container.bind<VersionManager>(TYPES.VersionManager).to(VersionManager);
  // Task Managers
  container.bind<CleanupManager>(TYPES.CleanupManager).to(CleanupManager);
  container.bind<BackgroundTaskManager>(TYPES.BackgroundTaskManager).to(BackgroundTaskManager);
  container.bind<KeyUpdateManager>(TYPES.KeyUpdateManager).to(KeyUpdateManager);
  // Other Services
  container.bind<ExportManager>(TYPES.ExportManager).to(ExportManager);
  container.bind<DiffManager>(TYPES.DiffManager).to(DiffManager);
  container.bind<UIService>(TYPES.UIService).to(UIService);

  container.bind<AppStore>(TYPES.Store).toDynamicValue(() => {    
  const initialState = getInitialState(plugin.settings);
    
  return createAppStore(initialState, container);
  });

  return container;
}
