import { Plugin, WorkspaceLeaf, FileView } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { VIEW_TYPE_VERSION_CONTROL } from '@/constants';
import { VersionControlView } from '@/ui/version-control-view';

/**
 * Registers all custom views with Obsidian.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerViews(plugin: Plugin, store: AppStore): void {
    plugin.registerView(
        VIEW_TYPE_VERSION_CONTROL,
        (leaf) => new VersionControlView(leaf, store, plugin.app)
    );
}

/**
 * Adds the ribbon icon for opening the Version Control view.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function addRibbonIcon(plugin: Plugin, store: AppStore): void {
    plugin.addRibbonIcon('history', 'Open version control', () => {
        activateViewAndDispatch(plugin, store);
    });
}

/**
 * Registers all plugin commands.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerCommands(plugin: Plugin, store: AppStore): void {
    plugin.addCommand({
        id: 'open-version-control-view',
        name: 'Open version control view',
        callback: () => activateViewAndDispatch(plugin, store),
    });

    plugin.addCommand({
        id: 'save-new-version',
        name: 'Save a new version of the current note',
        checkCallback: (checking: boolean) => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (activeFile && (activeFile.extension === 'md' || activeFile.extension === 'base')) {
                if (!checking) {
                    store.dispatch(thunks.saveNewVersion({}));
                }
                return true;
            }
            return false;
        }
    });

    plugin.addCommand({
        id: 'save-new-edit',
        name: 'Save a new edit of the current note',
        checkCallback: (checking: boolean) => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (activeFile && (activeFile.extension === 'md' || activeFile.extension === 'base')) {
                if (!checking) {
                    store.dispatch(thunks.saveNewEdit());
                }
                return true;
            }
            return false;
        }
    });

    plugin.addCommand({
        id: 'cleanup-orphaned-versions',
        name: 'Clean up orphaned version data',
        callback: () => {
            store.dispatch(thunks.cleanupOrphanedVersions());
        },
    });
}

/**
 * Helper function to activate the main view and dispatch the initialization thunk.
 * This logic was previously in the main plugin class.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
async function activateViewAndDispatch(plugin: Plugin, store: AppStore) {
    let contextLeaf: WorkspaceLeaf | null = null;
    
    // Use getMostRecentLeaf to find the last active context, as clicking the ribbon
    // might have shifted focus away from the editor.
    const recentLeaf = (plugin.app.workspace as any).getMostRecentLeaf?.() as WorkspaceLeaf | null;
    
    if (recentLeaf?.view instanceof FileView) {
        contextLeaf = recentLeaf;
    } else {
        // Fallback to active view if getMostRecentLeaf is not available or not a FileView
        const activeView = plugin.app.workspace.getActiveViewOfType(FileView);
        if (activeView) {
            contextLeaf = activeView.leaf;
        }
    }
    
    // Dispatch the initialization thunk. It will use the provided leaf as context,
    // or determine the context itself if the leaf is null.
    store.dispatch(thunks.initializeView(contextLeaf || undefined));

    // Determine the target window (document) based on the currently active UI context.
    // This ensures that if the user is in a popout window, we target that window
    // instead of defaulting to the main window.
    const activeLeaf = plugin.app.workspace.getLeaf(false);
    const targetDocument = activeLeaf?.view.containerEl.ownerDocument ?? document;

    const existingLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
    
    // Find a leaf that resides in the same window (document) as the active view.
    const leafInTargetWindow = existingLeaves.find(leaf => leaf.view.containerEl.ownerDocument === targetDocument);

    if (leafInTargetWindow) {
        plugin.app.workspace.revealLeaf(leafInTargetWindow);
    } else {
        let newLeaf: WorkspaceLeaf | null = null;

        // Check if we are in the main window or a popout
        if (targetDocument === document) {
            // Main Window: Use the standard Right Sidebar
            newLeaf = plugin.app.workspace.getRightLeaf(false);
        } else {
            // Popout Window: Sidebars are often not available or behave differently.
            // We create a vertical split to the right of the active leaf to mimic the sidebar behavior.
            // 'split' creates a new leaf adjacent to the currently active leaf.
            newLeaf = plugin.app.workspace.getLeaf('split', 'vertical');
        }

        // Fallback: If specific creation failed, try creating a generic tab
        if (!newLeaf) {
             newLeaf = plugin.app.workspace.getLeaf(true);
        }

        if (newLeaf) {
            await newLeaf.setViewState({
                type: VIEW_TYPE_VERSION_CONTROL,
                active: true,
            });
            plugin.app.workspace.revealLeaf(newLeaf);
        } else {
            console.error("Version Control: Could not get a leaf to activate the view.");
            store.dispatch(thunks.showNotice("Error: Could not open the version control view.", 7000));
        }
    }
}
