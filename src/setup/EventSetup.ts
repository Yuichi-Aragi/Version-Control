import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import { debounce } from 'lodash-es';
import type { AppStore } from '../state/store';
import { thunks } from '../state/thunks';
import { VIEW_TYPE_VERSION_CONTROL, VIEW_TYPE_VERSION_PREVIEW, VIEW_TYPE_VERSION_DIFF } from '../constants';

/**
 * Registers all listeners for global Obsidian events.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerSystemEventListeners(plugin: Plugin, store: AppStore): void {
    const debouncedLeafChangeHandler = debounce((leaf: WorkspaceLeaf | null) => {
        store.dispatch(thunks.initializeView(leaf));
    }, 100, { leading: false, trailing: true });

    plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', (leaf) => {
        const view = leaf?.view;
        // Do not re-initialize if the user is just clicking around within the plugin's own views.
        if (view?.getViewType() === VIEW_TYPE_VERSION_CONTROL || view?.getViewType() === VIEW_TYPE_VERSION_PREVIEW || view?.getViewType() === VIEW_TYPE_VERSION_DIFF) {
            return; 
        }
        debouncedLeafChangeHandler(leaf);
    }));
    
    plugin.registerEvent(plugin.app.metadataCache.on('changed', (file: TFile, _data: string, cache: CachedMetadata) => {
        store.dispatch(thunks.handleMetadataChange(file, cache));
    }));

    plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileRename(file, oldPath));
        }
    }));

    plugin.registerEvent(plugin.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileDelete(file));
        }
    }));
}
