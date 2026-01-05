import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Handles plugin unloading lifecycle.
 */
export class PluginUnloader {
    constructor(private plugin: VersionControlPlugin) {}

    /**
     * Performs complete plugin unload sequence.
     * Guaranteed to never throw, ensuring Obsidian can unload the plugin cleanly.
     */
    async unload(): Promise<void> {
        this.plugin.isUnloading = true; // Set the guard flag immediately to halt new operations

        try {
            // 1. Cancel any pending debounced operations to prevent them from firing during or after unload.
            try {
                this.plugin.cancelDebouncedOperations();
                this.plugin.queuedChangelogRequest = null;
            } catch (e) {
                console.warn("Version Control: Error cancelling debouncers", e);
            }

            // 2. Ensure any critical, queued file operations are completed before shutdown.
            try {
                await this.plugin.completePendingOperations();
            } catch (e) {
                console.warn("Version Control: Error completing pending operations", e);
            }

            // 3. The base Plugin class will automatically call `unload` on all child Components
            // that were added via `this.addChild()`. This handles the automatic cleanup of:
            //  - Event listeners registered in components.
            //  - Caches cleared via `component.register(() => cache.clear())`.
            //  - Intervals cleared in component `onunload` methods.

            if (this.plugin.services) {
                try {
                    const compressionManager = this.plugin.services.compressionManager;
                    if (compressionManager) {
                        compressionManager.terminate();
                    }
                } catch (e) {
                    console.warn("Version Control: Error terminating compression manager", e);
                }
            }

            // 4. Manually clean up the service registry and its non-component services.
            try {
                await this.plugin.cleanupServices();
            } catch (e) {
                console.warn("Version Control: Error cleaning up services", e);
            }

            // 5. Clean up the service registry singleton
            if (this.plugin.services) {
                try {
                    await this.plugin.services.cleanupAll();
                } catch (e) {
                    console.warn("Version Control: Error cleaning up registry", e);
                }
            }

            this.plugin.setInitialized(false);
        } catch (error) {
            // Catch-all for any unforeseen errors to prevent unload failure
            console.error("Version Control: Unexpected error during unload process.", error);
        }
    }
}
