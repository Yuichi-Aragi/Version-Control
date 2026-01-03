import { TFile, debounce, TAbstractFile } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import type VersionControlPlugin from '@/main';
import { ServiceRegistry } from '@/services-registry';

/**
 * Registers all listeners for global Obsidian events.
 * Implements 2025 performance patterns using requestIdleCallback to prevent
 * UI blocking during rapid file switching or metadata updates.
 * 
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerSystemEventListeners(plugin: VersionControlPlugin, store: AppStore): void {
    const services = ServiceRegistry.getInstance(plugin);
    const noteManager = services.noteManager;

    // Use file-open instead of active-leaf-change.
    // file-open is more stable for sidebar plugins as it doesn't fire when the user
    // interacts with the sidebar itself, keeping the "active note" context preserved.
    const handleFileOpen = debounce((_file: TFile | null) => {
        // PERF: Defer the heavy initialization thunk until the main thread is idle.
        // This ensures that the UI (editor switching, sidebar animations) remains
        // "buttery smooth" even if the version control initialization is expensive.
        // We set a timeout of 2000ms to ensure it eventually runs even under load.
        window.requestIdleCallback(() => {
            // We pass undefined to let the thunk resolve the best leaf context 
            // using getMostRecentLeaf() if necessary.
            store.dispatch(thunks.initializeView(undefined));
        }, { timeout: 2000 });
    }, 100);

    // Store the debouncer reference if needed for cleanup, 
    // though registerEvent handles the listener detachment.
    (plugin as any).debouncedFileOpenHandler = handleFileOpen;

    plugin.registerEvent(plugin.app.workspace.on('file-open', (file: TFile | null) => {
        handleFileOpen(file);
    }));
    
    plugin.registerEvent(plugin.app.metadataCache.on('changed', (file: TFile, _data: string, cache: CachedMetadata) => {
        // IGNORE INTERNAL WRITES:
        // If we just updated frontmatter programmatically (e.g. adding ID),
        // ignore this event to prevent infinite loops or unnecessary re-renders.
        if (noteManager.isInternalWrite(file.path) || noteManager.isPendingDeviation(file.path)) {
            return;
        }

        // Metadata changes can happen frequently during typing.
        // We defer processing to avoid stuttering the editor.
        window.requestIdleCallback(() => {
            store.dispatch(thunks.handleMetadataChange(file, cache));
        }, { timeout: 1000 });
    }));

    plugin.registerEvent(plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
            store.dispatch(thunks.handleFileRename(file, oldPath));
        }
    }));

    plugin.registerEvent(plugin.app.vault.on('delete', (file: TAbstractFile) => {
        // Dispatch handleFileDelete for both Files and Folders to handle cleanup
        store.dispatch(thunks.handleFileDelete(file));
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
            // IGNORE INTERNAL WRITES:
            // Prevent auto-save triggering when we just updated the file's frontmatter.
            if (noteManager.isInternalWrite(file.path) || noteManager.isPendingDeviation(file.path)) {
                return;
            }
            store.dispatch(thunks.handleVaultSave(file));
        }
    }));
}
