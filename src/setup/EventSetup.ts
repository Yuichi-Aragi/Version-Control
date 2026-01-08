import { TFile, TAbstractFile } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import type VersionControlPlugin from '@/main';
import { ServiceRegistry } from '@/services-registry';

/**
 * Registers all listeners for global Obsidian events.
 * Updated to ensure immediate UI synchronization on file switches while 
 * maintaining performance-heavy operations on idle threads.
 * * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerSystemEventListeners(plugin: VersionControlPlugin, store: AppStore): void {
    const services = ServiceRegistry.getInstance(plugin);
    const noteManager = services.noteManager;

    // 1. FILE-OPEN (Immediate Reaction)
    // We remove the debounce and requestIdleCallback here. 
    // This ensures the Redux store and UI update the instant the user clicks a file.
    plugin.registerEvent(plugin.app.workspace.on('file-open', (_file: TFile | null) => {
        // Immediate dispatch for UI responsiveness
        store.dispatch(thunks.initializeView(undefined));
    }));
    
    // 2. METADATA CHANGES (Deferred)
    // Metadata changes trigger frequently during typing; keeping these deferred
    // prevents the editor from lagging during heavy composition.
    plugin.registerEvent(plugin.app.metadataCache.on('changed', (file: TFile, _data: string, cache: CachedMetadata) => {
        // IGNORE INTERNAL WRITES:
        if (noteManager.isInternalWrite(file.path) || noteManager.isPendingDeviation(file.path)) {
            return;
        }

        window.requestIdleCallback(() => {
            store.dispatch(thunks.handleMetadataChange(file, cache));
        }, { timeout: 1000 });
    }));

    // 3. VAULT MOVEMENTS (Immediate)
    // Renames and deletes are discrete user actions and should update the state immediately.
    plugin.registerEvent(plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileRename(file, oldPath));
        }
    }));

    plugin.registerEvent(plugin.app.vault.on('delete', (file: TAbstractFile) => {
        store.dispatch(thunks.handleFileDelete(file));
    }));

    // 4. VAULT CREATION
    plugin.registerEvent(plugin.app.vault.on('create', (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'base') {
            store.dispatch(thunks.handleVaultSave(file));
        }
    }));

    // 5. FILE MODIFICATION (Save/Manual Edits)
    plugin.registerEvent(plugin.app.vault.on('modify', (file: TAbstractFile) => {
        if (file instanceof TFile && (file.extension === 'md' || file.extension === 'base')) {
            // Prevent feedback loops during frontmatter updates
            if (noteManager.isInternalWrite(file.path) || noteManager.isPendingDeviation(file.path)) {
                return;
            }
            store.dispatch(thunks.handleVaultSave(file));
        }
    }));
}
