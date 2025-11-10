import { injectable, inject } from 'inversify';
import { Component } from 'obsidian';
import type { AppStore } from '../../state/store';
import { thunks } from '../../state/thunks';
import { AppStatus } from '../../state/state';
import { actions } from '../../state/appSlice';
import { TYPES } from '../../types/inversify.types';

/**
 * Configuration interface for watch mode settings
 */
interface WatchModeConfig {
  readonly enableWatchMode: boolean;
  readonly watchModeInterval: number;
}

/**
 * State interface for the app store
 */
interface AppState {
  readonly status: AppStatus;
  readonly noteId: string | null;
  readonly isProcessing: boolean;
  readonly settings: WatchModeConfig;
  readonly watchModeCountdown: number | null;
}

/**
 * Type-safe interval ID wrapper
 */
class IntervalId {
  private constructor(private readonly id: number) {}

  public static from(id: number): IntervalId {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`Invalid interval ID: ${id}`);
    }
    return new IntervalId(id);
  }

  public getValue(): number {
    return this.id;
  }
}

/**
 * Manages periodic background tasks for the plugin, such as
 * watch mode auto-saving. It is stateful and ensures that intervals are not
 * needlessly reset.
 * Extends Component to tie its lifecycle to the plugin's.
 */
@injectable()
export class BackgroundTaskManager extends Component {
  private watchModeIntervalId: IntervalId | null = null;
  private watchModeCountdownIntervalId: IntervalId | null = null;

  // State to track the currently active interval's context
  private activeIntervalNoteId: string | null = null;
  private activeIntervalSeconds: number | null = null;
  private lastSyncTime: number = 0;
  private readonly MIN_SYNC_INTERVAL = 100; // Minimum time between syncs in ms

  constructor(@inject(TYPES.Store) private readonly store: AppStore) {
    super();
    this.validateDependencies();
  }

  /**
   * Validates all injected dependencies
   */
  private validateDependencies(): void {
    if (!this.store) {
      throw new Error('AppStore dependency is required');
    }
    if (typeof this.store.getState !== 'function') {
      throw new Error('AppStore must implement getState method');
    }
    if (typeof this.store.dispatch !== 'function') {
      throw new Error('AppStore must implement dispatch method');
    }
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
    // Throttle sync calls to prevent excessive processing
    const now = Date.now();
    if (now - this.lastSyncTime < this.MIN_SYNC_INTERVAL) {
      return;
    }
    this.lastSyncTime = now;

    try {
      const state = this.store.getState() as AppState;
      this.validateState(state);

      const shouldBeRunning = this.shouldWatchModeRun(state);
      const isRunning = this.watchModeIntervalId !== null;

      if (shouldBeRunning) {
        const currentNoteId = state.noteId!; // Safe due to validation
        const currentIntervalSeconds = state.settings.watchModeInterval;

        // Validate interval value
        if (!Number.isInteger(currentIntervalSeconds) || currentIntervalSeconds <= 0) {
          console.error('Invalid watch mode interval:', currentIntervalSeconds);
          this.stopIntervals();
          return;
        }

        // If it's already running for the correct note and with the correct interval, do nothing.
        if (isRunning && 
            this.activeIntervalNoteId === currentNoteId && 
            this.activeIntervalSeconds === currentIntervalSeconds) {
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
    } catch (error) {
      console.error('Error in syncWatchMode:', error);
      // Ensure intervals are stopped on error
      this.stopIntervals();
    }
  }

  /**
   * Validates the app state structure
   */
  private validateState(state: AppState): void {
    if (!state) {
      throw new Error('App state is undefined');
    }
    if (!state.settings) {
      throw new Error('Settings are undefined in app state');
    }
    if (typeof state.settings.enableWatchMode !== 'boolean') {
      throw new Error('enableWatchMode setting must be a boolean');
    }
    if (typeof state.settings.watchModeInterval !== 'number') {
      throw new Error('watchModeInterval setting must be a number');
    }
  }

  /**
   * Determines if watch mode should be running based on current state
   */
  private shouldWatchModeRun(state: AppState): boolean {
    return state.settings.enableWatchMode && 
           state.status === AppStatus.READY && 
           !!state.noteId;
  }

  private startIntervals(noteId: string, intervalSeconds: number): void {
    try {
      // Validate inputs
      if (!noteId || typeof noteId !== 'string') {
        throw new Error('Invalid note ID provided');
      }
      if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
        throw new Error('Invalid interval seconds provided');
      }

      // Store the context of the new interval
      this.activeIntervalNoteId = noteId;
      this.activeIntervalSeconds = intervalSeconds;
      const intervalMs = intervalSeconds * 1000;

      // Validate intervalMs isn't too small (could cause performance issues)
      if (intervalMs < 1000) {
        console.warn('Watch mode interval is very small (< 1s), this may impact performance');
      }

      this.watchModeIntervalId = IntervalId.from(window.setInterval(() => {
        this.handleWatchModeTick();
      }, intervalMs));

      // UI Countdown timer
      this.startCountdownTimer(intervalSeconds);
    } catch (error) {
      console.error('Error starting intervals:', error);
      this.stopIntervals();
    }
  }

  private handleWatchModeTick(): void {
    try {
      // Re-check conditions inside the interval callback to ensure context hasn't changed.
      const currentState = this.store.getState() as AppState;
      
      if (currentState.status === AppStatus.READY && 
          !currentState.isProcessing && 
          currentState.noteId === this.activeIntervalNoteId) {
        this.store.dispatch(thunks.saveNewVersion({ isAuto: true }));
      }
    } catch (error) {
      console.error('Error in watch mode tick:', error);
      // Don't stop the interval on error, just log it
    }
  }

  private startCountdownTimer(intervalSeconds: number): void {
    let countdown = intervalSeconds;
    this.store.dispatch(actions.setWatchModeCountdown(countdown)); // Initial value
    
    try {
      this.watchModeCountdownIntervalId = IntervalId.from(window.setInterval(() => {
        countdown--;
        if (countdown < 0) {
          // Use stored value to reset, in case settings changed but interval hasn't restarted yet
          countdown = this.activeIntervalSeconds ?? intervalSeconds; 
        }
        this.store.dispatch(actions.setWatchModeCountdown(countdown));
      }, 1000));
    } catch (error) {
      console.error('Error starting countdown timer:', error);
      this.store.dispatch(actions.setWatchModeCountdown(null));
    }
  }

  private stopIntervals(): void {
    try {
      if (this.watchModeIntervalId !== null) {
        window.clearInterval(this.watchModeIntervalId.getValue());
        this.watchModeIntervalId = null;
      }
      if (this.watchModeCountdownIntervalId !== null) {
        window.clearInterval(this.watchModeCountdownIntervalId.getValue());
        this.watchModeCountdownIntervalId = null;
      }
      
      // Reset tracking state
      this.activeIntervalNoteId = null;
      this.activeIntervalSeconds = null;

      // Clear from UI if it hasn't been cleared already
      const currentState = this.store.getState() as AppState;
      if (currentState.watchModeCountdown !== null) {
        this.store.dispatch(actions.setWatchModeCountdown(null));
      }
    } catch (error) {
      console.error('Error stopping intervals:', error);
      // Force reset state even if cleanup fails
      this.watchModeIntervalId = null;
      this.watchModeCountdownIntervalId = null;
      this.activeIntervalNoteId = null;
      this.activeIntervalSeconds = null;
    }
  }
}
