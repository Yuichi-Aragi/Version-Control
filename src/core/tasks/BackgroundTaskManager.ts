import { Component } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { AppStatus } from '@/state';
import { appSlice } from '@/state';
import type VersionControlPlugin from '@/main';
import type { HistorySettings } from '@/types';
import { historyApi } from '@/state/apis/history.api';

/**
 * Manages periodic background tasks for the plugin, specifically watch mode auto-saving.
 * Leverages RTK Query for data access to ensure consistency with the UI and single source of truth.
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
    private readonly plugin: VersionControlPlugin
  ) {
    super();
  }

  public override onunload(): void {
    this.stopTimer();
  }

  /**
   * Synchronizes the watch mode state with the current application state.
   * This method is idempotent and should be called whenever:
   * 1. The active note changes.
   * 2. The view mode changes.
   * 3. Settings (global or local) change.
   */
  public async syncWatchMode(): Promise<void> {
    const state = this.store.getState().app;
    const currentNoteId = state.noteId;

    // If we are not in a valid state to watch, stop everything.
    if (!currentNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      this.activeNoteId = null;
      this.store.dispatch(appSlice.actions.setWatchModeCountdown(null));
      return;
    }

    // If the note context changed, reset timers
    if (this.activeNoteId !== currentNoteId) {
      this.activeNoteId = currentNoteId;
      this.nextVersionSaveTime = null;
      this.nextEditSaveTime = null;
    }

    // Resolve settings for the current context using RTK Query
    const versionSettings = await this.resolveSettings(currentNoteId, 'version');
    const editSettings = await this.resolveSettings(currentNoteId, 'edit');

    // --- Setup Version Watch ---
    if (versionSettings.enableWatchMode) {
      this.versionInterval = versionSettings.watchModeInterval * 1000;
      // Initialize timer if not set, or if it was previously disabled
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
      // Initialize timer if not set, or if it was previously disabled
      if (this.nextEditSaveTime === null) {
        this.nextEditSaveTime = Date.now() + this.editInterval;
      }
    } else {
      this.editInterval = null;
      this.nextEditSaveTime = null;
    }

    // Start or stop the tick loop based on whether any watch mode is active
    if (this.versionInterval !== null || this.editInterval !== null) {
      this.startTimer();
      // Force an immediate tick to update the UI countdown
      this.tick();
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
    
    // Safety check: if context changed underneath us, stop.
    if (state.noteId !== this.activeNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      return;
    }

    // Trigger Version Save
    if (this.nextVersionSaveTime !== null && now >= this.nextVersionSaveTime) {
      this.triggerVersionSave();
      this.nextVersionSaveTime = now + (this.versionInterval || 60000);
    }

    // Trigger Edit Save
    if (this.nextEditSaveTime !== null && now >= this.nextEditSaveTime) {
      this.triggerEditSave();
      this.nextEditSaveTime = now + (this.editInterval || 60000);
    }

    // Update UI Countdown based on current View Mode
    let countdown: number | null = null;
    
    if (state.viewMode === 'versions' && this.nextVersionSaveTime !== null) {
      countdown = Math.ceil((this.nextVersionSaveTime - now) / 1000);
      // Clamp to 0 to avoid negative numbers just before save
      if (countdown < 0) countdown = 0;
    } else if (state.viewMode === 'edits' && this.nextEditSaveTime !== null) {
      countdown = Math.ceil((this.nextEditSaveTime - now) / 1000);
      if (countdown < 0) countdown = 0;
    }
    
    if (state.watchModeCountdown !== countdown) {
      this.store.dispatch(appSlice.actions.setWatchModeCountdown(countdown));
    }
  }

  private async triggerVersionSave() {
    if (!this.activeNoteId) return;
    const settings = await this.resolveSettings(this.activeNoteId, 'version');
    const hybridSettings = { ...this.plugin.settings, ...settings };
    // Note: isAuto=true implies allowInit=false by default, preventing auto-creation of new history
    this.store.dispatch(thunks.saveNewVersion({ isAuto: true, settings: hybridSettings }));
  }

  private async triggerEditSave() {
    if (!this.activeNoteId) return;
    // Note: isAuto=true, allowInit=false prevents auto-creation of new history
    this.store.dispatch(thunks.saveNewEdit({ isAuto: true, allowInit: false }));
  }

  private async resolveSettings(noteId: string, type: 'version' | 'edit'): Promise<HistorySettings> {
    // 1. Get Branch Info via RTK Query
    // We capture the subscription handle first, then await the result.
    const branchSubscription = this.store.dispatch(
      historyApi.endpoints.getBranches.initiate(noteId, { forceRefetch: true })
    );

    let branchName = 'main';
    try {
        const branchResult = await branchSubscription;
        if (branchResult.data) {
            branchName = branchResult.data.currentBranch;
        }
    } catch (e) {
        console.warn("VC: Failed to resolve branch for settings", e);
    } finally {
        branchSubscription.unsubscribe();
    }

    // 2. Get Effective Settings via RTK Query
    const viewMode = type === 'version' ? 'versions' : 'edits';
    const settingsSubscription = this.store.dispatch(
      historyApi.endpoints.getEffectiveSettings.initiate(
        { noteId, viewMode, branchName },
        { forceRefetch: true }
      )
    );

    try {
        const settingsResult = await settingsSubscription;
        if (settingsResult.data) {
            return settingsResult.data;
        }
    } catch (e) {
        console.warn("VC: Failed to resolve settings", e);
    } finally {
        settingsSubscription.unsubscribe();
    }

    // Fallback to global defaults if API fails or returns nothing
    const globalDefaults = type === 'version'
        ? this.plugin.settings.versionHistorySettings
        : this.plugin.settings.editHistorySettings;

    return { ...globalDefaults, isGlobal: true };
  }
}
