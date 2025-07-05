import { Store } from '../state/store';
import { thunks } from '../state/thunks';
import { AppStatus } from '../state/state';
import { actions } from '../state/actions';

/**
 * Manages periodic background tasks for the plugin, such as
 * orphaned version cleanup and watch mode auto-saving.
 */
export class BackgroundTaskManager {
    private store: Store;
    private periodicOrphanCleanupInterval: number | null = null;
    private watchModeIntervalId: number | null = null;
    private watchModeCountdownIntervalId: number | null = null;

    private readonly ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    constructor(store: Store) {
        this.store = store;
    }

    /**
     * Starts or stops the periodic orphan cleanup task based on current settings.
     */
    public managePeriodicOrphanCleanup(): void {
        // Clear existing interval before checking settings
        if (this.periodicOrphanCleanupInterval !== null) {
            window.clearInterval(this.periodicOrphanCleanupInterval);
            this.periodicOrphanCleanupInterval = null;
        }

        if (this.store.getState().settings.autoCleanupOrphanedVersions) {
            // Initial cleanup after a delay
            setTimeout(() => this.store.dispatch(thunks.cleanupOrphanedVersions(false)), 5 * 60 * 1000);

            this.periodicOrphanCleanupInterval = window.setInterval(() => {
                this.store.dispatch(thunks.cleanupOrphanedVersions(false));
            }, this.ORPHAN_CLEANUP_INTERVAL_MS);
            console.log("Version Control: Periodic orphaned version cleanup scheduled.");
        } else {
            console.log("Version Control: Periodic orphaned version cleanup is disabled.");
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

        if (!settings.enableWatchMode) {
            return;
        }

        if (state.status === AppStatus.READY) {
            const intervalSeconds = settings.watchModeInterval;
            const intervalMs = intervalSeconds * 1000;
            
            this.watchModeIntervalId = window.setInterval(() => {
                const currentState = this.store.getState();
                // Re-check conditions inside the interval callback
                if (currentState.status === AppStatus.READY && !currentState.isProcessing) {
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

            console.log(`Version Control: Watch mode timer started with ${settings.watchModeInterval}s interval.`);
        }
    }

    /**
     * Clears all running intervals. Called on plugin unload.
     */
    public clearAllIntervals(): void {
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
        console.log("Version Control: All background task intervals cleared.");
    }
}
