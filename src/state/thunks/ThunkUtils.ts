import type { Container } from 'inversify';
import type VersionControlPlugin from '../../main';
import { TYPES } from '../../types/inversify.types';

/**
 * Checks if the plugin is in the process of unloading.
 * This is a crucial guard to prevent thunks from executing against a destroyed
 * or partially destroyed dependency injection container, which causes "No bindings found" errors.
 * @param container The Inversify container from the thunk's extraArgument.
 * @returns `true` if the plugin is unloading and the thunk should abort, `false` otherwise.
 */
export const isPluginUnloading = (container: Container): boolean => {
    try {
        // We must get the plugin instance from the container to check its state.
        const plugin = container.get<VersionControlPlugin>(TYPES.Plugin);
        if (plugin.isUnloading) {
            // This is not an error, just a race condition that we are correctly handling.
            return true;
        }
        return false;
    } catch (e) {
        // If getting the plugin from the container fails, it's a definitive sign that
        // the container is being torn down. The thunk must not proceed.
        return true;
    }
};
