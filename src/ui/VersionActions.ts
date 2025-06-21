import { Menu } from 'obsidian';
import { VersionHistoryEntry } from '../types';
import { thunks } from '../state/thunks';
import { Store } from '../state/store';
import { Thunk } from '../state/store';

/**
 * Defines the structure for a user-performable action on a version.
 */
export interface VersionAction {
    id: string;
    title: string;
    icon: string;
    tooltip: string;
    isDanger?: boolean;
    /**
     * A function that returns the appropriate thunk for this action.
     */
    thunk: (version: VersionHistoryEntry) => Thunk;
}

/**
 * A centralized array of all possible actions for a version.
 * This is the single source of truth for creating buttons and context menus.
 */
export const versionActions: VersionAction[] = [
    {
        id: 'view',
        title: 'View Content',
        icon: 'eye',
        tooltip: 'View content',
        thunk: (version) => thunks.viewVersion(version),
    },
    {
        id: 'restore',
        title: 'Restore This Version',
        icon: 'rotate-ccw',
        tooltip: 'Restore this version',
        thunk: (version) => thunks.requestRestore(version),
    },
    {
        id: 'deviation',
        title: 'Create Note From Version',
        icon: 'git-branch',
        tooltip: 'Create note from version',
        thunk: (version) => thunks.createDeviation(version),
    },
    {
        id: 'delete',
        title: 'Delete Version',
        icon: 'trash-2',
        tooltip: 'Delete version',
        isDanger: true,
        thunk: (version) => thunks.requestDelete(version),
    },
];

/**
 * Creates and displays a context menu for a given version entry.
 * @param version The version history entry.
 * @param event The mouse event that triggered the menu.
 * @param store The application's state store.
 */
export function showVersionContextMenu(version: VersionHistoryEntry, event: MouseEvent, store: Store) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();

    const standardItems = versionActions.filter(a => !a.isDanger);
    const dangerItems = versionActions.filter(a => a.isDanger);

    standardItems.forEach(action => {
        menu.addItem((item) =>
            item
                .setTitle(action.title)
                .setIcon(action.icon)
                .onClick(() => store.dispatch(action.thunk(version)))
        );
    });

    if (dangerItems.length > 0) {
        menu.addSeparator();
        dangerItems.forEach(action => {
            menu.addItem((item) =>
                item
                    .setTitle(action.title)
                    .setIcon(action.icon)
                    .setSection('danger')
                    .onClick(() => store.dispatch(action.thunk(version)))
            );
        });
    }

    menu.showAtMouseEvent(event);
}