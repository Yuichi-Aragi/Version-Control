import { Plugin, WorkspaceLeaf, FileView, TFile } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { VIEW_TYPE_VERSION_CONTROL } from '@/constants';
import { VersionControlView } from '@/ui/version-control-view';

/**
 * Registers the custom Version Control view using stable API.
 */
export function registerViews(plugin: Plugin, store: AppStore): void {
    plugin.registerView(
        VIEW_TYPE_VERSION_CONTROL,
        (leaf: WorkspaceLeaf) => new VersionControlView(leaf, store)
    );
}

/**
 * Adds ribbon icon with modern click handler pattern.
 */
export function addRibbonIcon(plugin: Plugin, store: AppStore): void {
    plugin.addRibbonIcon('history', 'Open version control', (_evt: MouseEvent) => {
        activateViewAndDispatch(plugin, store);
    });
}

/**
 * Registers all commands with proper checkCallback patterns and typing.
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
        checkCallback: (checking: boolean): boolean => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (isValidNoteFile(activeFile)) {
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
        checkCallback: (checking: boolean): boolean => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (isValidNoteFile(activeFile)) {
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
        callback: () => store.dispatch(thunks.cleanupOrphanedVersions()),
    });
}

/**
 * Validates note files using stable extension check.
 */
function isValidNoteFile(file: TFile | null): file is TFile {
    return Boolean(file && (file.extension === 'md' || file.extension === 'base'));
}


/**
 * Activates Version Control view following 2026 best practices:
 * - Context-aware leaf targeting (main/popout windows)
 * - Lazy loading support via revealLeaf/setViewState
 * - Performance optimization with onLayoutReady
 * - Enhanced error boundaries and typing
 */
async function activateViewAndDispatch(
    plugin: Plugin, 
    store: AppStore
): Promise<void> {
    // Determine context leaf from most recent FileView (modern pattern)
    const contextLeaf = getContextLeaf(plugin.app.workspace);
    
    // Defer initialization until layout is fully ready to prevent race conditions
    plugin.app.workspace.onLayoutReady(() => {
        store.dispatch(thunks.initializeView(contextLeaf || undefined));
    });

    // Target correct window/document (essential for popouts)
    const targetDocument = getTargetDocument(plugin.app.workspace);
    const existingLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
    const leafInTargetWindow = existingLeaves.find(
        leaf => leaf.view?.containerEl?.ownerDocument === targetDocument
    );

    if (leafInTargetWindow) {
        await plugin.app.workspace.revealLeaf(leafInTargetWindow);
        return;
    }

    // Create new leaf following platform-aware patterns
    const newLeaf = await createTargetLeaf(plugin.app.workspace, targetDocument);
    if (newLeaf) {
        await newLeaf.setViewState({ 
            type: VIEW_TYPE_VERSION_CONTROL, 
            active: true 
        });
        plugin.app.workspace.revealLeaf(newLeaf);
    } else {
        console.error('Version Control: Failed to create leaf');
        store.dispatch(thunks.showNotice(
            'Error: Could not open version control view. Please try again.', 
            5000
        ));
    }
}

/**
 * Gets context leaf from most recent FileView (stable API).
 */
function getContextLeaf(workspace: any): WorkspaceLeaf | null {
    const recentLeaf = workspace.getMostRecentLeaf();
    if (recentLeaf?.view instanceof FileView) {
        return recentLeaf;
    }
    
    const activeView = workspace.getActiveViewOfType(FileView);
    return activeView?.leaf ?? null;
}

/**
 * Determines target document for multi-window support.
 */
function getTargetDocument(workspace: any): Document {
    const activeLeaf = workspace.getLeaf(false);
    return activeLeaf?.view?.containerEl?.ownerDocument ?? document;
}

/**
 * Creates leaf using modern sidebar/popout-aware patterns.
 */
async function createTargetLeaf(workspace: any, targetDocument: Document): Promise<WorkspaceLeaf | null> {
    if (targetDocument === document) {
        // Main window: prefer right sidebar
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) return rightLeaf;
    } else {
        // Popout: vertical split mimics sidebar behavior
        const splitLeaf = workspace.getLeaf('split', 'vertical');
        if (splitLeaf) return splitLeaf;
    }
    
    // Universal fallback: new tab
    return workspace.getLeaf(true);
}
