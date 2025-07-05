import { Plugin, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { Store } from '../state/store';
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
export function registerViews(plugin: Plugin, store: Store): void {
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
export function addRibbonIcon(plugin: Plugin, store: Store): void {
    plugin.addRibbonIcon('history', 'Open Version Control', () => {
        activateViewAndDispatch(plugin, store);
    });
}

/**
 * Registers all plugin commands.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerCommands(plugin: Plugin, store: Store): void {
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
            store.dispatch(thunks.cleanupOrphanedVersions(true));
        },
    });
}

/**
 * Helper function to activate the main view and dispatch the initialization thunk.
 * This logic was previously in the main plugin class.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
async function activateViewAndDispatch(plugin: Plugin, store: Store) {
    let contextLeaf: WorkspaceLeaf | null = null;
    const currentActiveLeaf = plugin.app.workspace.activeLeaf;

    if (currentActiveLeaf && currentActiveLeaf.view instanceof MarkdownView) {
        const mdView = currentActiveLeaf.view as MarkdownView;
        if (mdView.file && mdView.file.extension === 'md') {
            contextLeaf = currentActiveLeaf;
        }
    }
    
    store.dispatch(thunks.initializeView(contextLeaf));

    const existingLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
    if (existingLeaves.length > 0) {
        plugin.app.workspace.revealLeaf(existingLeaves[0]);
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
