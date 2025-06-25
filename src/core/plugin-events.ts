import { Events } from 'obsidian';

/**
 * Defines the signatures for all custom events used within the plugin.
 * This provides type safety and autocompletion for event handling.
 */
export interface VersionControlEvents {
    'version-saved': (noteId: string) => void;
    'version-deleted': (noteId: string) => void;
    'history-deleted': (noteId: string) => void;
}

/**
 * The central event bus for the plugin. It extends Obsidian's built-in
 * `Events` class and is typed with our custom event signatures.
 * Services can emit and listen for events on this bus to communicate
 * in a decoupled manner.
 */
export class PluginEvents extends Events implements Omit<VersionControlEvents, 'on' | 'off' | 'trigger'> {
    // This class is intentionally empty. It inherits all functionality from Obsidian's Events.
    // The interface implementation is for type-checking and auto-completion, allowing us
    // to use `eventBus.on('version-saved', ...)` with full type safety.
}
