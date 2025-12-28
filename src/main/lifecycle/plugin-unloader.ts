import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Handles plugin unloading lifecycle.
 */
export class PluginUnloader {
    constructor(private plugin: VersionControlPlugin) {}

    /**
     * Performs complete plugin unload sequence.
     */
    async unload(): Promise<void> {
        this.plugin.isUnloading = true; // Set the guard flag immediately to halt new operations

        try {
            // 1. Cancel any pending debounced operations to prevent them from firing during or after unload.
            this.plugin.cancelDebouncedOperations();
            this.plugin.queuedChangelogRequest = null;

            // 2. Ensure any critical, queued file operations are completed before shutdown.
            await this.plugin.completePendingOperations();

            // 3. The base Plugin class will automatically call `unload` on all child Components
            // that were added via `this.addChild()`. This handles the automatic cleanup of:
            //  - Event listeners registered in components.
            //  - Caches cleared via `component.register(() => cache.clear())`.
            //  - Intervals cleared in component `onunload` methods.

            if (this.plugin.services) {
                const compressionManager = this.plugin.services.compressionManager;
                if (compressionManager) {
                    compressionManager.terminate();
                }
            }

            // 4. Manually clean up the service registry and its non-component services.
            await this.plugin.cleanupServices();

            // 5. Clean up the service registry singleton
            if (this.plugin.services) {
                await this.plugin.services.cleanupAll();
            }

            this.plugin.setInitialized(false);
        } catch (error) {
            console.error("Version Control: Error during unload process.", error);
        }
    }
}
