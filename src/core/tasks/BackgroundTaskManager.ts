import { injectable, inject } from 'inversify';
import { Component } from 'obsidian';
import type { AppStore } from '../../state/store';
import { thunks } from '../../state/thunks';
import { AppStatus } from '../../state/state';
import { actions } from '../../state/appSlice';
import { TYPES } from '../../types/inversify.types';
import type { ManifestManager } from '../manifest-manager';
import type { EditHistoryManager } from '../edit-history-manager';
import type VersionControlPlugin from '../../main';
import type { HistorySettings } from '../../types';

/**
 * Manages periodic background tasks for the plugin, specifically watch mode auto-saving.
 * 
 * It handles:
 * 1. Dual-mode tracking: Runs separate timers for Version History and Edit History.
 * 2. Context isolation: Only runs for the active note ID.
 * 3. Settings isolation: Resolves settings specifically for the active note's active branch.
 * 4. UI Feedback: Updates the countdown timer based on the currently active view mode.
 */
@injectable()
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
    @inject(TYPES.Store) private readonly store: AppStore,
    @inject(TYPES.ManifestManager) private readonly manifestManager: ManifestManager,
    @inject(TYPES.EditHistoryManager) private readonly editHistoryManager: EditHistoryManager,
    @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin
  ) {
    super();
  }

  public override onunload(): void {
    this.stopTimer();
  }

  /**
   * Synchronizes the watch mode state with the current application state.
   * This should be called whenever:
   * - The active note changes
   * - Settings change
   * - A save occurs (to reset timers)
   */
  public async syncWatchMode(): Promise<void> {
    const state = this.store.getState();
    const currentNoteId = state.noteId;

    // If no active note or app not ready, stop everything
    if (!currentNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      this.activeNoteId = null;
      this.store.dispatch(actions.setWatchModeCountdown(null));
      return;
    }

    // If the note context changed, reset all timers
    if (this.activeNoteId !== currentNoteId) {
      this.activeNoteId = currentNoteId;
      this.nextVersionSaveTime = null;
      this.nextEditSaveTime = null;
    }

    // Resolve settings for both modes independently for the active note
    const versionSettings = await this.resolveSettings(currentNoteId, 'version');
    const editSettings = await this.resolveSettings(currentNoteId, 'edit');

    // --- Setup Version Watch ---
    if (versionSettings.enableWatchMode) {
      this.versionInterval = versionSettings.watchModeInterval * 1000;
      // Initialize next save time if not already set
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
      // Initialize next save time if not already set
      if (this.nextEditSaveTime === null) {
        this.nextEditSaveTime = Date.now() + this.editInterval;
      }
    } else {
      this.editInterval = null;
      this.nextEditSaveTime = null;
    }

    // Start or Stop the main tick timer
    if (this.versionInterval !== null || this.editInterval !== null) {
      this.startTimer();
    } else {
      this.stopTimer();
      this.store.dispatch(actions.setWatchModeCountdown(null));
    }
  }

  private startTimer() {
    if (this.timerId !== null) return;
    // Run tick every second to update UI and check triggers
    this.timerId = window.setInterval(() => this.tick(), 1000);
    this.tick(); // Immediate update
  }

  private stopTimer() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick() {
    const now = Date.now();
    const state = this.store.getState();
    
    // Safety check: Ensure context hasn't drifted
    if (state.noteId !== this.activeNoteId || state.status !== AppStatus.READY) {
      this.stopTimer();
      return;
    }

    // --- Handle Version Save Trigger ---
    if (this.nextVersionSaveTime !== null && now >= this.nextVersionSaveTime) {
      this.triggerVersionSave();
      // Reset timer
      this.nextVersionSaveTime = now + (this.versionInterval || 60000);
    }

    // --- Handle Edit Save Trigger ---
    if (this.nextEditSaveTime !== null && now >= this.nextEditSaveTime) {
      this.triggerEditSave();
      // Reset timer
      this.nextEditSaveTime = now + (this.editInterval || 60000);
    }

    // --- Update UI Countdown ---
    // We only show the countdown for the *currently active* view mode.
    let countdown: number | null = null;
    
    if (state.viewMode === 'versions' && this.nextVersionSaveTime !== null) {
      countdown = Math.ceil((this.nextVersionSaveTime - now) / 1000);
    } else if (state.viewMode === 'edits' && this.nextEditSaveTime !== null) {
      countdown = Math.ceil((this.nextEditSaveTime - now) / 1000);
    }
    
    // Dispatch only if changed to avoid Redux noise
    if (state.watchModeCountdown !== countdown) {
      this.store.dispatch(actions.setWatchModeCountdown(countdown));
    }
  }

  private async triggerVersionSave() {
    if (!this.activeNoteId) return;
    
    // Resolve fresh settings to ensure we pass the correct configuration to the thunk.
    // This ensures that the save respects the active branch's settings.
    const settings = await this.resolveSettings(this.activeNoteId, 'version');
    
    // Merge with global settings (for ID formats, etc.)
    const hybridSettings = { ...this.plugin.settings, ...settings };
    
    this.store.dispatch(thunks.saveNewVersion({ isAuto: true, settings: hybridSettings }));
  }

  private async triggerEditSave() {
    if (!this.activeNoteId) return;
    // Edit save logic is simpler and mostly self-contained, but we trigger it as auto.
    this.store.dispatch(thunks.saveNewEdit(true));
  }

  /**
   * Resolves settings for a specific note and type, respecting the active branch
   * and global/local overrides. This duplicates logic from settingsUtils to ensure
   * isolation and independence from the global 'effectiveSettings' state.
   */
  private async resolveSettings(noteId: string, type: 'version' | 'edit'): Promise<HistorySettings> {
    const globalDefaults = type === 'version' 
        ? this.plugin.settings.versionHistorySettings 
        : this.plugin.settings.editHistorySettings;

    const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
    if (!noteManifest) return { ...globalDefaults, isGlobal: true };

    const currentBranch = noteManifest.currentBranch;
    let perBranchSettings: Partial<HistorySettings> | undefined;

    // Helper to filter out undefined values for exactOptionalPropertyTypes compatibility
    const filterDefinedSettings = (settings: Record<string, unknown> | undefined): Partial<HistorySettings> | undefined => {
        if (!settings) return undefined;
        return Object.fromEntries(
            Object.entries(settings).filter(([, v]) => v !== undefined)
        ) as Partial<HistorySettings>;
    };

    if (type === 'version') {
        perBranchSettings = filterDefinedSettings(noteManifest.branches[currentBranch]?.settings);
    } else {
        const editManifest = await this.editHistoryManager.getEditManifest(noteId);
        perBranchSettings = filterDefinedSettings(editManifest?.branches[currentBranch]?.settings);
    }

    const isUnderGlobalInfluence = perBranchSettings?.isGlobal !== false;
    if (isUnderGlobalInfluence) {
        return { ...globalDefaults, isGlobal: true };
    } else {
         const definedBranchSettings = Object.fromEntries(
            Object.entries(perBranchSettings ?? {}).filter(([, v]) => v !== undefined)
        );
        return { ...globalDefaults, ...definedBranchSettings, isGlobal: false };
    }
  }
}
