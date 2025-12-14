import type { AppStore } from '@/state';
import { registerCommands } from '@/setup';
import type VersionControlPlugin from '@/main/VersionControlPlugin';

/**
 * Handles command registration for the plugin.
 */
export class CommandRegistrar {
    constructor(
        private plugin: VersionControlPlugin,
        private store: AppStore
    ) {}

    /**
     * Registers all plugin commands.
     */
    registerCommands(): void {
        try {
            registerCommands(this.plugin, this.store);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error("Version Control: Command registration failed", error);
            throw new Error(`Command registration failed: ${errorMessage}`);
        }
    }
}
