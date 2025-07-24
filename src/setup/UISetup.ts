import { Plugin, WorkspaceLeaf, MarkdownView } from 'obsidian';
import type { AppStore } from '../state/store';
import { thunks } from '../state/thunks';
import { VIEW_TYPE_VERSION_CONTROL, VIEW_TYPE_VERSION_PREVIEW, VIEW_TYPE_VERSION_DIFF } from '../constants';
import { VersionControlView } from '../ui/version-control-view';
import { VersionPreviewView } from '../ui/version-preview-view';
import { VersionDiffView } from '../ui/version-diff-view';

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
    plugin.registerView(
        VIEW_TYPE_VERSION_PREVIEW,
        (leaf) => new VersionPreviewView(leaf, store, plugin.app)
    );
    plugin.registerView(
        VIEW_TYPE_VERSION_DIFF,
        (leaf) => new VersionDiffView(leaf, store, plugin.app)
    );
}

/**
 * Adds the ribbon icon for opening the Version Control view.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function addRibbonIcon(plugin: Plugin, store: AppStore): void {
    plugin.addRibbonIcon('history', 'Open Version Control', () => {
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
        name: 'Open Version Control View',
        callback: () => activateViewAndDispatch(plugin, store),
    });

    plugin.addCommand({
        id: 'save-new-version',
        name: 'Save a new version of the current note',
        checkCallback: (checking: boolean) => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (activeFile && activeFile.extension === 'md') {
                if (!checking) {
                    store.dispatch(thunks.saveNewVersion());
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
    // Use the recommended API to find the active markdown view. This is safer
    // than relying on `activeLeaf` which could be a non-markdown view.
    const activeMarkdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    // If there's an active markdown view with a file, its leaf is our context.
    if (activeMarkdownView && activeMarkdownView.file) {
        contextLeaf = activeMarkdownView.leaf;
    }
    
    // Dispatch the initialization thunk. It will use the provided leaf as context,
    // or determine the context itself if the leaf is null.
    store.dispatch(thunks.initializeView(contextLeaf));

    const existingLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
    // The root cause of the error is that accessing an array element by index (e.g.,
    // `existingLeaves[0]`) is typed as `T | undefined`. A simple length check is not
    // always sufficient for the compiler to eliminate the `undefined` possibility.
    // To fix this with 100% type safety, we get the element first and then perform
    // a direct truthiness check on it. This explicitly proves to the compiler that
    // the value is a valid `WorkspaceLeaf` before it's used.
    const leafToReveal = existingLeaves[0];

    if (leafToReveal) {
        plugin.app.workspace.revealLeaf(leafToReveal);
    } else {
        const newLeaf = plugin.app.workspace.getRightLeaf(false);
        if (newLeaf) {
            await newLeaf.setViewState({
                type: VIEW_TYPE_VERSION_CONTROL,
                active: true,
            });
            plugin.app.workspace.revealLeaf(newLeaf);
        } else {
            console.error("Version Control: Could not get a leaf to activate the view.");
            store.dispatch(thunks.showNotice("Error: Could not open Version Control view.", 7000));
        }
    }
}
