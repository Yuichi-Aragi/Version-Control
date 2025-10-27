import { TFile, WorkspaceLeaf, debounce, TAbstractFile } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import type { AppStore } from '../state/store';
import { thunks } from '../state/thunks';
import { VIEW_TYPE_VERSION_CONTROL } from '../constants';
import type VersionControlPlugin from '../main';

/**
 * Registers all listeners for global Obsidian events.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerSystemEventListeners(plugin: VersionControlPlugin, store: AppStore): void {
    plugin.debouncedLeafChangeHandler = debounce((leaf: WorkspaceLeaf | null) => {
        store.dispatch(thunks.initializeView(leaf));
    }, 100);

    plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        const view = leaf?.view;
        // Do not re-initialize if the user is just clicking around within the plugin's own view.
        if (view?.getViewType() === VIEW_TYPE_VERSION_CONTROL) {
            return; 
        }
        plugin.debouncedLeafChangeHandler?.(leaf);
    }));
    
    plugin.registerEvent(plugin.app.metadataCache.on('changed', (file: TFile, _data: string, cache: CachedMetadata) => {
        store.dispatch(thunks.handleMetadataChange(file, cache));
    }));

    plugin.registerEvent(plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileRename(file, oldPath));
        }
    }));

    plugin.registerEvent(plugin.app.vault.on('delete', (file: TAbstractFile) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileDelete(file));
        }
    }));

    plugin.registerEvent(plugin.app.vault.on('create', (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'base') {
            store.dispatch(thunks.handleVaultSave(file));
        }
    }));

    // This event fires when a file is modified on disk, which is the most reliable
    // proxy for a "save" event (e.g., from Ctrl+S or external changes).
    plugin.registerEvent(plugin.app.vault.on('modify', (file: TAbstractFile) => {
        if (file instanceof TFile && (file.extension === 'md' || file.extension === 'base')) {
            store.dispatch(thunks.handleVaultSave(file));
        }
    }));
}
