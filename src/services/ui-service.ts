import { App, Notice, Component } from 'obsidian';
import type { AppStore } from '@/state';

/**
 * A dedicated service for managing all UI interactions, such as notices,
 * modals, and context menus. This decouples the business logic (thunks)
 * from the Obsidian-specific UI APIs.
 */
export class UIService extends Component {
    constructor(
        _app: App, 
        _store: AppStore
    ) {
        super();
    }

    /**
     * Displays a notice to the user.
     * @param message The message to display.
     * @param duration The duration in milliseconds (default: 5000).
     */
    showNotice(message: string, duration: number = 5000): void {
        new Notice(message, duration);
    }
}
