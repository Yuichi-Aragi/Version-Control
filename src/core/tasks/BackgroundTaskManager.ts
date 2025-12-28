import { Component } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { AppStatus } from '@/state';
import { appSlice } from '@/state';
import type { ManifestManager } from '@/core';
import type { EditHistoryManager } from '@/core';
import type VersionControlPlugin from '@/main';
import type { HistorySettings } from '@/types';
import { SettingsResolver, type LoosePartial } from '@/core/settings';

/**
 * Manages periodic background tasks for the plugin, specifically watch mode auto-saving.
 */
export class BackgroundTaskManager extends Component {
  private timerId: number | null = null;
  
  // The note ID we are currently tracking
  private activeNoteId: string | null = null;
  
  // Target timestamps for next save (in milliseconds)
  private nextVersionSaveTime: number | null = null;
  private nextEditSaveTime: number | null = null;
  
  // Cached intervals (in milliseconds) derived from settings
  private versionInterval: number | null = null;
  private editInterval: number | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly manifestManager: ManifestManager,
    private readonly editHistoryManager: EditHistoryManager,
    private readonly plugin: VersionControlPlugin
  ) {
    super();
  }

  public override onunload(): void {
    this.stopTimer();
  }

  /**
   * Synchronizes the watch mode state with the current application state.
   */
  public async syncWatchMode(): Promise<void> {
    const state = this.store.getState().app;
    const currentNoteId = state.noteId;

    if (!currentNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      this.activeNoteId = null;
      this.store.dispatch(appSlice.actions.setWatchModeCountdown(null));
      return;
    }

    if (this.activeNoteId !== currentNoteId) {
      this.activeNoteId = currentNoteId;
      this.nextVersionSaveTime = null;
      this.nextEditSaveTime = null;
    }

    const versionSettings = await this.resolveSettings(currentNoteId, 'version');
    const editSettings = await this.resolveSettings(currentNoteId, 'edit');

    // --- Setup Version Watch ---
    if (versionSettings.enableWatchMode) {
      this.versionInterval = versionSettings.watchModeInterval * 1000;
      if (this.nextVersionSaveTime === null) {
        this.nextVersionSaveTime = Date.now() + this.versionInterval;
      }
    } else {
      this.versionInterval = null;
      this.nextVersionSaveTime = null;
    }

    // --- Setup Edit Watch ---
    if (editSettings.enableWatchMode) {
      this.editInterval = editSettings.watchModeInterval * 1000;
      if (this.nextEditSaveTime === null) {
        this.nextEditSaveTime = Date.now() + this.editInterval;
      }
    } else {
      this.editInterval = null;
      this.nextEditSaveTime = null;
    }

    if (this.versionInterval !== null || this.editInterval !== null) {
      this.startTimer();
    } else {
      this.stopTimer();
      this.store.dispatch(appSlice.actions.setWatchModeCountdown(null));
    }
  }

  public resetTimer(type: 'version' | 'edit'): void {
    const now = Date.now();
    if (type === 'version') {
      if (this.versionInterval !== null) {
        this.nextVersionSaveTime = now + this.versionInterval;
        this.tick(); 
      }
    } else {
      if (this.editInterval !== null) {
        this.nextEditSaveTime = now + this.editInterval;
        this.tick();
      }
    }
  }

  private startTimer() {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  private stopTimer() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick() {
    const now = Date.now();
    const state = this.store.getState().app;
    
    if (state.noteId !== this.activeNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      return;
    }

    if (this.nextVersionSaveTime !== null && now >= this.nextVersionSaveTime) {
      this.triggerVersionSave();
      this.nextVersionSaveTime = now + (this.versionInterval || 60000);
    }

    if (this.nextEditSaveTime !== null && now >= this.nextEditSaveTime) {
      this.triggerEditSave();
      this.nextEditSaveTime = now + (this.editInterval || 60000);
    }

    let countdown: number | null = null;
    
    if (state.viewMode === 'versions' && this.nextVersionSaveTime !== null) {
      countdown = Math.ceil((this.nextVersionSaveTime - now) / 1000);
    } else if (state.viewMode === 'edits' && this.nextEditSaveTime !== null) {
      countdown = Math.ceil((this.nextEditSaveTime - now) / 1000);
    }
    
    if (state.watchModeCountdown !== countdown) {
      this.store.dispatch(appSlice.actions.setWatchModeCountdown(countdown));
    }
  }

  private async triggerVersionSave() {
    if (!this.activeNoteId) return;
    const settings = await this.resolveSettings(this.activeNoteId, 'version');
    const hybridSettings = { ...this.plugin.settings, ...settings };
    this.store.dispatch(thunks.saveNewVersion({ isAuto: true, settings: hybridSettings }));
  }

  private async triggerEditSave() {
    if (!this.activeNoteId) return;
    this.store.dispatch(thunks.saveNewEdit(true));
  }

  private async resolveSettings(noteId: string, type: 'version' | 'edit'): Promise<HistorySettings> {
    const globalDefaults = type === 'version'
        ? this.plugin.settings.versionHistorySettings
        : this.plugin.settings.editHistorySettings;

    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) return { ...globalDefaults, isGlobal: true };

    const currentBranch = noteManifest.currentBranch;
    let perBranchSettings: LoosePartial<HistorySettings> | undefined;

    if (type === 'version') {
        perBranchSettings = noteManifest.branches[currentBranch]?.settings;
    } else {
        const editManifest = await this.editHistoryManager.getEditManifest(noteId);
        perBranchSettings = editManifest?.branches[currentBranch]?.settings;
    }

    return SettingsResolver.resolve(globalDefaults, perBranchSettings);
  }
}
