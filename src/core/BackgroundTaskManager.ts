import { injectable, inject } from 'inversify';
import { Component } from 'obsidian';
import type { AppStore } from '../state/store';
import { thunks } from '../state/thunks';
import { AppStatus } from '../state/state';
import { actions } from '../state/appSlice';
import { TYPES } from '../types/inversify.types';

/**
 * Manages periodic background tasks for the plugin, such as
 * watch mode auto-saving. It is stateful and ensures that intervals are not
 * needlessly reset.
 * Extends Component to tie its lifecycle to the plugin's.
 */
@injectable()
export class BackgroundTaskManager extends Component {
  private watchModeIntervalId: number | null = null;
  private watchModeCountdownIntervalId: number | null = null;

  // State to track the currently active interval's context
  private activeIntervalNoteId: string | null = null;
  private activeIntervalSeconds: number | null = null;

  constructor(@inject(TYPES.Store) private readonly store: AppStore) {
    super();
  }

  /**
   * This method is called automatically by Obsidian when the plugin unloads.
   */
  public override onunload(): void {
    this.stopIntervals();
  }

  /**
   * Synchronizes the watch mode state. It checks the current app state and settings,
   * and then starts, stops, or updates the watch mode interval to match.
   * This is the main entry point to be called when context (active note, settings) might have changed.
   */
  public syncWatchMode(): void {
    const state = this.store.getState();
    const settings = state.settings;

    const shouldBeRunning = settings.enableWatchMode && state.status === AppStatus.READY && !!state.noteId;
    const isRunning = this.watchModeIntervalId !== null;

    if (shouldBeRunning) {
        const currentNoteId = state.noteId!; // We know it's not null from shouldBeRunning check
        const currentIntervalSeconds = settings.watchModeInterval;

        // If it's already running for the correct note and with the correct interval, do nothing.
        if (isRunning && this.activeIntervalNoteId === currentNoteId && this.activeIntervalSeconds === currentIntervalSeconds) {
            return;
        }

        // Otherwise, the state is out of sync. Stop the old one (if any) and start the new one.
        this.stopIntervals();
        this.startIntervals(currentNoteId, currentIntervalSeconds);

    } else {
        // It should not be running. If it is, stop it.
        if (isRunning) {
            this.stopIntervals();
        }
    }
  }

  private startIntervals(noteId: string, intervalSeconds: number): void {
    // Store the context of the new interval
    this.activeIntervalNoteId = noteId;
    this.activeIntervalSeconds = intervalSeconds;
    const intervalMs = intervalSeconds * 1000;

    this.watchModeIntervalId = window.setInterval(() => {
      // Re-check conditions inside the interval callback to ensure context hasn't changed.
      const currentState = this.store.getState();
      if (currentState.status === AppStatus.READY && !currentState.isProcessing && currentState.noteId === this.activeIntervalNoteId) {
        this.store.dispatch(thunks.saveNewVersion({ isAuto: true }));
      }
    }, intervalMs);

    // UI Countdown timer
    let countdown = intervalSeconds;
    this.store.dispatch(actions.setWatchModeCountdown(countdown)); // Initial value
    this.watchModeCountdownIntervalId = window.setInterval(() => {
      countdown--;
      if (countdown < 0) {
        // Use stored value to reset, in case settings changed but interval hasn't restarted yet
        countdown = this.activeIntervalSeconds ?? intervalSeconds; 
      }
      this.store.dispatch(actions.setWatchModeCountdown(countdown));
    }, 1000);
  }

  private stopIntervals(): void {
    if (this.watchModeIntervalId !== null) {
      window.clearInterval(this.watchModeIntervalId);
      this.watchModeIntervalId = null;
    }
    if (this.watchModeCountdownIntervalId !== null) {
      window.clearInterval(this.watchModeCountdownIntervalId);
      this.watchModeCountdownIntervalId = null;
    }
    
    // Reset tracking state
    this.activeIntervalNoteId = null;
    this.activeIntervalSeconds = null;

    // Clear from UI if it hasn't been cleared already
    if (this.store.getState().watchModeCountdown !== null) {
        this.store.dispatch(actions.setWatchModeCountdown(null));
    }
  }
}
