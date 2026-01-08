import type VersionControlPlugin from '@/main/VersionControlPlugin';
import { historyApi } from '@/state/apis/history.api';
import { changelogApi } from '@/state/apis/changelog.api';
import { ServiceRegistry } from '@/services-registry';

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

            // 6. Reset ServiceRegistry Singleton to allow fresh init on reload
            ServiceRegistry.resetInstance();

            // 7. Reset RTK Query State to clear caches and subscriptions
            // This ensures that if the plugin is reloaded, we don't have stale cache entries.
            if (this.plugin.store) {
                this.plugin.store.dispatch(historyApi.util.resetApiState());
                this.plugin.store.dispatch(changelogApi.util.resetApiState());
                // Explicitly nullify store reference on plugin to aid GC
                this.plugin.store = null as any;
            }
            
            // Nullify services reference
            this.plugin.services = null as any;

            this.plugin.setInitialized(false);
        } catch (error) {
            // Catch-all for any unforeseen errors to prevent unload failure
            console.error("Version Control: Unexpected error during unload process.", error);
        }
    }
}
