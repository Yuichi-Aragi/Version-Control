import { Events } from 'obsidian';
import { injectable } from 'inversify';

/**
 * Defines the signatures for all custom events used within the plugin.
 * This provides type safety and autocompletion for event handling.
 */
export interface VersionControlEvents {
    'version-saved': (noteId: string) => void;
    'version-deleted': (noteId: string) => void;
    'history-deleted': (noteId: string) => void;
    'version-updated': (noteId: string, versionId: string, data: { name?: string; description?: string }) => void;
}

/**
 * The central event bus for the plugin. It uses composition to wrap Obsidian's
 * `Events` class, providing a strongly-typed interface for custom plugin events.
 * This avoids inheritance issues with TypeScript's strict function types.
 */
@injectable()
export class PluginEvents {
    private bus = new Events();

    /**
     * Registers a callback for a given event.
     * @param name The name of the event.
     * @param callback The function to call when the event is triggered.
     * @param ctx Optional context to bind the callback to.
     */
    on<K extends keyof VersionControlEvents>(name: K, callback: VersionControlEvents[K], ctx?: any): void {
        // The underlying Obsidian Events class expects a generic callback.
        // We are casting our strongly-typed callback to `any` to satisfy the
        // generic signature of `this.bus.on`. This is safe because our `trigger`
        // method is also strongly-typed and ensures that the correct arguments
        // are passed, upholding the contract defined in `VersionControlEvents`.
        this.bus.on(name, callback as (...data: any[]) => any, ctx);
    }

    /**
     * Unregisters a callback for a given event.
     * @param name The name of the event.
     * @param callback The callback function to unregister.
     */
    off<K extends keyof VersionControlEvents>(name: K, callback: VersionControlEvents[K]): void {
        // Similar to `on`, we cast the callback to `any` for compatibility with
        // the generic `this.bus.off` method.
        this.bus.off(name, callback as (...data: any[]) => any);
    }

    /**
     * Triggers an event, calling all registered callbacks.
     * @param name The name of the event to trigger.
     * @param args The arguments to pass to the callbacks.
     */
    trigger<K extends keyof VersionControlEvents>(name: K, ...args: Parameters<VersionControlEvents[K]>): void {
        // The `...args` are correctly typed here due to `Parameters<...>`,
        // ensuring type safety when triggering events.
        this.bus.trigger(name, ...args);
    }
}
