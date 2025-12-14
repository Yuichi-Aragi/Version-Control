import { Container } from 'inversify';
import type { App } from 'obsidian';
import { TYPES } from '@/types/inversify.types';
import type VersionControlPlugin from '@/main';
import { createAppStore, type AppStore } from '@/state';
import { getInitialState } from '@/state';
import { PluginEvents } from '@/core';
import { PathService } from '@/core';
import { QueueService } from '@/services';
import { CentralManifestRepository } from '@/core';
import { NoteManifestRepository } from '@/core';
import { VersionContentRepository } from '@/core';
import { TimelineDatabase } from '@/core';
import { ManifestManager } from '@/core';
import { NoteManager } from '@/core';
import { CleanupManager } from '@/core';
import { VersionManager } from '@/core';
import { TimelineManager } from '@/core';
import { ExportManager } from '@/services';
import { DiffManager } from '@/services';
import { UIService } from '@/services';
import { BackgroundTaskManager } from '@/core';
import { StorageService } from '@/core';
import { EditHistoryManager } from '@/core';
import { CompressionManager } from "@/core";


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
  container.bind<TimelineDatabase>(TYPES.TimelineDatabase).to(TimelineDatabase);
  
  // High-level Managers
  container.bind<ManifestManager>(TYPES.ManifestManager).to(ManifestManager);
  container.bind<NoteManager>(TYPES.NoteManager).to(NoteManager);
  container.bind<VersionManager>(TYPES.VersionManager).to(VersionManager);
  container.bind<TimelineManager>(TYPES.TimelineManager).to(TimelineManager);
  container.bind<EditHistoryManager>(TYPES.EditHistoryManager).to(EditHistoryManager);
  
  container.bind<CompressionManager>(TYPES.CompressionManager).to(CompressionManager);
  
  // Task Managers
  container.bind<CleanupManager>(TYPES.CleanupManager).to(CleanupManager);
  container.bind<BackgroundTaskManager>(TYPES.BackgroundTaskManager).to(BackgroundTaskManager);
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
