import { injectable, inject } from 'inversify';
import { Component } from 'obsidian';
import type { AppStore } from '../state/store';
import { thunks } from '../state/thunks';
import { AppStatus } from '../state/state';
import { actions } from '../state/appSlice';
import { TYPES } from '../types/inversify.types';

/**
 * Manages periodic background tasks for the plugin, such as
 * orphaned version cleanup and watch mode auto-saving.
 * Extends Component to tie its lifecycle to the plugin's.
 */
@injectable()
export class BackgroundTaskManager extends Component {
    private store: AppStore;
    private periodicOrphanCleanupInterval: number | null = null;
    private initialOrphanCleanupTimeout: number | null = null;
    private watchModeIntervalId: number | null = null;
    private watchModeCountdownIntervalId: number | null = null;

    private readonly ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    constructor(@inject(TYPES.Store) store: AppStore) {
        super();
        this.store = store;
    }

    public override onunload(): void {
        // This method is called automatically by Obsidian when the plugin unloads
        // because this component is registered as a child in main.ts.
        this.clearAllIntervals();
    }

    /**
     * Starts or stops the periodic orphan cleanup task based on current settings.
     */
    public managePeriodicOrphanCleanup(): void {
        // Clear existing interval and timeout before checking settings
        if (this.periodicOrphanCleanupInterval !== null) {
            window.clearInterval(this.periodicOrphanCleanupInterval);
            this.periodicOrphanCleanupInterval = null;
        }
        if (this.initialOrphanCleanupTimeout !== null) {
            window.clearTimeout(this.initialOrphanCleanupTimeout);
            this.initialOrphanCleanupTimeout = null;
        }

        if (this.store.getState().settings.autoCleanupOrphanedVersions) {
            // Initial cleanup after a delay. The timeout ID is stored and cleared
            // in onunload to prevent it from firing after the plugin is disabled.
            this.initialOrphanCleanupTimeout = window.setTimeout(() => {
                // The thunk itself is safe, but this timeout must be cleared on unload.
                this.store.dispatch(thunks.cleanupOrphanedVersions(false));
            }, 5 * 60 * 1000);

            this.periodicOrphanCleanupInterval = window.setInterval(() => {
                this.store.dispatch(thunks.cleanupOrphanedVersions(false));
            }, this.ORPHAN_CLEANUP_INTERVAL_MS);
        }
    }

    /**
     * Starts or stops the watch mode auto-save task based on current settings and app state.
     */
    public manageWatchModeInterval(): void {
        // Clear existing intervals first
        if (this.watchModeIntervalId) {
            window.clearInterval(this.watchModeIntervalId);
            this.watchModeIntervalId = null;
        }
        if (this.watchModeCountdownIntervalId) {
            window.clearInterval(this.watchModeCountdownIntervalId);
            this.watchModeCountdownIntervalId = null;
            this.store.dispatch(actions.setWatchModeCountdown(null)); // Clear from UI
        }

        const state = this.store.getState();
        const settings = state.settings;

        // Exit if watch mode is not enabled for the current context.
        if (!settings.enableWatchMode) {
            return;
        }

        // Exit if the application is not in a state where auto-saving is possible.
        if (state.status !== AppStatus.READY || !state.noteId) {
            return;
        }

        // If we've reached here, all conditions are met. Start the intervals.
        const watchedNoteId = state.noteId; // Capture the noteId for the interval's closure
        const intervalSeconds = settings.watchModeInterval;
        const intervalMs = intervalSeconds * 1000;
        
        this.watchModeIntervalId = window.setInterval(() => {
            const currentState = this.store.getState();
            // Re-check conditions inside the interval callback to ensure context hasn't changed.
            // The active note must be the one we started watching, and the app must still be ready and not busy.
            if (currentState.status === AppStatus.READY && 
                !currentState.isProcessing &&
                currentState.noteId === watchedNoteId) {
                this.store.dispatch(thunks.saveNewVersion({ isAuto: true }));
            }
        }, intervalMs);

        // UI Countdown timer
        let countdown = intervalSeconds;
        this.store.dispatch(actions.setWatchModeCountdown(countdown)); // Initial value
        this.watchModeCountdownIntervalId = window.setInterval(() => {
            countdown--;
            if (countdown < 0) { // Use < 0 to show 0 before reset
                countdown = intervalSeconds; // Reset for next cycle
            }
            this.store.dispatch(actions.setWatchModeCountdown(countdown));
        }, 1000);
    }

    /**
     * Clears all running intervals. Called on plugin unload via the Component lifecycle.
     */
    private clearAllIntervals(): void {
        if (this.periodicOrphanCleanupInterval !== null) {
            window.clearInterval(this.periodicOrphanCleanupInterval);
            this.periodicOrphanCleanupInterval = null;
        }
        if (this.watchModeIntervalId !== null) {
            window.clearInterval(this.watchModeIntervalId);
            this.watchModeIntervalId = null;
        }
        if (this.watchModeCountdownIntervalId !== null) {
            window.clearInterval(this.watchModeCountdownIntervalId);
            this.watchModeCountdownIntervalId = null;
        }
        // This is the critical fix for the unload crash. The timeout must be cleared
        // to prevent its callback from executing on a stale plugin instance.
        if (this.initialOrphanCleanupTimeout !== null) {
            window.clearTimeout(this.initialOrphanCleanupTimeout);
            this.initialOrphanCleanupTimeout = null;
        }
    }
}
