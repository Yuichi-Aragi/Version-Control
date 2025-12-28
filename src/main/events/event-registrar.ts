import type { AppStore } from '@/state';
import { thunks, AppStatus } from '@/state';
import type { PluginEvents } from '@/core';
import { registerSystemEventListeners } from '@/setup';
import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Handles event listener registration and cleanup.
 */
export class EventRegistrar {
    constructor(
        private plugin: VersionControlPlugin,
        private store: AppStore,
        private eventBus: PluginEvents
    ) {}

    /**
     * Sets up all event listeners with proper cleanup.
     */
    setupEventListeners(): void {
        try {
            // Register system event listeners (file events, workspace events, etc.)
            registerSystemEventListeners(this.plugin, this.store);

            // Add a listener to refresh the UI after background cleanups.
            const handleVersionDeleted = (noteId: string) => {
                if (this.plugin.isUnloading) return;
                try {
                    const state = this.store.getState();
                    if (state.app.status === AppStatus.READY && state.app.noteId === noteId && state.app.file) {
                        this.store.dispatch(thunks.loadHistory(state.app.file));
                    }
                } catch (error) {
                    console.error("Version Control: Error in version deleted handler", error);
                }
            };

            this.eventBus.on('version-deleted', handleVersionDeleted);
            this.plugin.register(() => this.eventBus.off('version-deleted', handleVersionDeleted));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error("Version Control: Event listener setup failed", error);
            throw new Error(`Event listener setup failed: ${errorMessage}`);
        }
    }
}
