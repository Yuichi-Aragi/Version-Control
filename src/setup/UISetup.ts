import { Plugin, WorkspaceLeaf, FileView, TFile } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { VIEW_TYPE_VERSION_CONTROL } from '@/constants';
import { VersionControlView } from '@/ui/version-control-view';

/**
 * Registers all custom views with Obsidian.
 */
export function registerViews(plugin: Plugin, store: AppStore): void {
    plugin.registerView(
        VIEW_TYPE_VERSION_CONTROL,
        (leaf) => new VersionControlView(leaf, store)
    );
}

/**
 * Registers all plugin commands.
 * Use checkCallback to improve UX by hiding/disabling commands in invalid contexts.
 */
export function registerCommands(plugin: Plugin, store: AppStore): void {
    plugin.addCommand({
        id: 'open-version-control-view',
        name: 'Open version control view',
        callback: () => activateViewAndDispatch(plugin, store),
    });

    // Helper for versioning commands to avoid duplication
    const addVersioningCommand = (id: string, name: string, thunkCreator: () => any) => {
        plugin.addCommand({
            id,
            name,
            checkCallback: (checking: boolean) => {
                const activeFile = plugin.app.workspace.getActiveFile();
                // Check if file exists and is of correct extension
                const isValidFile = activeFile instanceof TFile && 
                                   ['md', 'base'].includes(activeFile.extension);
                
                if (isValidFile) {
                    if (!checking) {
                        store.dispatch(thunkCreator());
                    }
                    return true;
                }
                return false;
            }
        });
    };

    addVersioningCommand('save-new-version', 'Save a new version of the current note', () => thunks.saveNewVersion({}));
    addVersioningCommand('save-new-edit', 'Save a new edit of the current note', () => thunks.saveNewEdit());

    plugin.addCommand({
        id: 'cleanup-orphaned-versions',
        name: 'Clean up orphaned version data',
        callback: () => store.dispatch(thunks.cleanupOrphanedVersions()),
    });
}

/**
 * Adds the ribbon icon.
 */
export function addRibbonIcon(plugin: Plugin, store: AppStore): void {
    plugin.addRibbonIcon('history', 'Open version control', () => {
        activateViewAndDispatch(plugin, store);
    });
}

/**
 * Modern (2026) implementation of view activation.
 * Handles popout windows, deferred views, and performance optimizations.
 */
async function activateViewAndDispatch(plugin: Plugin, store: AppStore) {
    const { workspace } = plugin.app;

    // 1. Determine Context: Use getMostRecentLeaf to find the last active editor
    // This works across different windows and sidebars.
    const recentLeaf = workspace.getMostRecentLeaf();
    const contextLeaf = recentLeaf?.view instanceof FileView ? recentLeaf : null;

    // 2. Find or Create Leaf: Correct multi-window check
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_VERSION_CONTROL);
    // Explicitly type leaf to handle potential null/undefined values safely
    // Use non-null assertion or fallback since noUncheckedIndexedAccess might be enabled
    let leaf: WorkspaceLeaf | null = leaves.length > 0 ? (leaves[0] ?? null) : null;

    if (!leaf) {
        // If not found, create it in the right sidebar (standard for utility views)
        leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_VERSION_CONTROL,
                active: true,
            });
        }
    }

    // 3. Ensure View is Loaded (Deferred View Support)
    if (leaf) {
        // Obsidian 1.7.2+ can defer loading views. This ensures the view is ready before dispatching.
        await leaf.loadIfDeferred();               

        // 4. Reveal the Leaf: This uncollapses sidebars if needed.
        workspace.revealLeaf(leaf);
    }

    // 5. Performance Optimization: Defer state initialization
    // Ensures the UI transition animation finishes smoothly before heavy state logic starts.
    if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {
            store.dispatch(thunks.initializeView(contextLeaf ?? undefined));
        }, { timeout: 1000 });
    } else {
        // Fallback for environments without requestIdleCallback
        setTimeout(() => store.dispatch(thunks.initializeView(contextLeaf ?? undefined)), 100);
    }
}
