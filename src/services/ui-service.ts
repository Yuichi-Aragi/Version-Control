import { App, Menu, Notice, TFolder, MouseEvent as ObsidianMouseEvent, Component } from 'obsidian';
import { Store } from '../state/store';
import { DiffTarget, VersionHistoryEntry, VersionActionConfig } from '../types';
import { FolderSuggest, VersionSuggest } from '../ui/suggesters';
import { versionActions } from '../ui/VersionActions';
import { thunks } from '../state/thunks';
import { SortDirection, SortOrder, SortProperty } from '../state/state';
import { actions } from '../state/actions';

/**
 * A dedicated service for managing all UI interactions, such as notices,
 * modals, and context menus. This decouples the business logic (thunks)
 * from the Obsidian-specific UI APIs.
 */
export class UIService extends Component {
    constructor(private app: App, private store: Store) {
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

    /**
     * Prompts the user to select a folder.
     * @returns A promise that resolves with the selected TFolder, or null if cancelled.
     */
    promptForFolder(): Promise<TFolder | null> {
        return new Promise((resolve) => {
            new FolderSuggest(this.app, 
                (folder) => resolve(folder),
                () => resolve(null) // Resolve with null on cancel
            ).open();
        });
    }

    /**
     * Prompts the user to select a version from a list of targets.
     * @param targets The list of versions and/or the current state to choose from.
     * @returns A promise that resolves with the selected DiffTarget, or null if cancelled.
     */
    promptForVersion(targets: DiffTarget[]): Promise<DiffTarget | null> {
        return new Promise((resolve) => {
            new VersionSuggest(this.app, targets,
                (version) => resolve(version),
                () => resolve(null) // Resolve with null on cancel
            ).open();
        });
    }

    /**
     * Shows a context menu with "Preview in Panel" and "Preview in New Tab" options.
     */
    showPreviewOptions(version: VersionHistoryEntry, event: ObsidianMouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle("Preview in Panel")
                .setIcon("sidebar-right")
                .onClick(() => this.store.dispatch(thunks.viewVersionInPanel(version)))
        );
        menu.addItem((item) =>
            item
                .setTitle("Preview in New Tab")
                .setIcon("file-text")
                .onClick(() => this.store.dispatch(thunks.viewVersionInNewTab(version)))
        );
        menu.showAtMouseEvent(event);
    }

    /**
     * Shows the full context menu for a specific version.
     */
    showVersionContextMenu(version: VersionHistoryEntry, event: ObsidianMouseEvent): void {
        const menu = new Menu();

        // View Content (which opens a sub-menu)
        menu.addItem((item) =>
            item
                .setTitle("View Content")
                .setIcon("eye")
                .onClick((mouseEvent) => {
                    this.showPreviewOptions(version, mouseEvent as ObsidianMouseEvent);
                })
        );
        menu.addSeparator();

        // Standard Actions
        const standardActions = versionActions.filter(action => !action.isDanger);
        standardActions.forEach(actionConfig => {
            this.addMenuItem(menu, actionConfig, version);
        });

        // Danger Actions
        const dangerActions = versionActions.filter(action => action.isDanger);
        if (dangerActions.length > 0) {
            menu.addSeparator();
            dangerActions.forEach(actionConfig => {
                this.addMenuItem(menu, actionConfig, version, true);
            });
        }

        menu.showAtMouseEvent(event);
    }

    /**
     * Shows a generic context menu from a list of options.
     * @param options An array of menu item configurations.
     * @param event The mouse event to position the menu at.
     */
    showActionMenu(options: { title: string, icon: string, callback: () => void }[], event?: MouseEvent): void {
        const menu = new Menu();
        options.forEach(opt => {
            menu.addItem(item => item
                .setTitle(opt.title)
                .setIcon(opt.icon)
                .onClick(opt.callback)
            );
        });

        if (event) {
            menu.showAtMouseEvent(event);
        } else {
            // Show in the middle of the active leaf if no event is provided
            const activeLeaf = this.app.workspace.activeLeaf?.containerEl;
            if (activeLeaf) {
                const rect = activeLeaf.getBoundingClientRect();
                menu.showAtPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 });
            } else {
                menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            }
        }
    }

    /**
     * Shows a context menu for sorting options.
     * @param currentSortOrder The currently active sort order to display a checkmark.
     * @param event The mouse event to position the menu at.
     */
    showSortMenu(currentSortOrder: SortOrder, event: MouseEvent): void {
        const menu = new Menu();
        const sortOptions: { label: string; property: SortProperty; direction: SortDirection }[] = [
            { label: 'Version (New to Old)', property: 'versionNumber', direction: 'desc' },
            { label: 'Version (Old to New)', property: 'versionNumber', direction: 'asc' },
            { label: 'Timestamp (New to Old)', property: 'timestamp', direction: 'desc' },
            { label: 'Timestamp (Old to New)', property: 'timestamp', direction: 'asc' },
            { label: 'Name (A to Z)', property: 'name', direction: 'asc' },
            { label: 'Name (Z to A)', property: 'name', direction: 'desc' },
            { label: 'Size (Largest to Smallest)', property: 'size', direction: 'desc' },
            { label: 'Size (Smallest to Largest)', property: 'size', 'direction': 'asc' },
        ];

        sortOptions.forEach(opt => {
            menu.addItem(item => {
                item.setTitle(opt.label)
                    .onClick(() => {
                        this.store.dispatch(actions.setSortOrder({ property: opt.property, direction: opt.direction }));
                    });
                if (currentSortOrder.property === opt.property && currentSortOrder.direction === opt.direction) {
                    item.setIcon('check');
                }
            });
        });
        menu.showAtMouseEvent(event);
    }

    private addMenuItem(menu: Menu, config: VersionActionConfig, version: VersionHistoryEntry, isDanger: boolean = false): void {
        menu.addItem((item) => {
            item
                .setTitle(config.title)
                .setIcon(config.icon)
                .onClick(() => {
                    // The action handler in VersionActions now just dispatches a thunk
                    config.actionHandler(version, this.store);
                });
            if (isDanger) {
                item.setSection('danger');
            }
        });
    }
}
