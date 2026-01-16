import { TFile, TAbstractFile } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import type VersionControlPlugin from '@/main';
import { ServiceRegistry } from '@/services-registry';

/**
 * Registers all listeners for global Obsidian events using stable v1.11+ APIs.
 * - Immediate UI sync on file-open and vault mutations for responsiveness.
 * - Deferred metadata handling to prevent lag during typing/composition.
 * - Guards against internal feedback loops.
 * @param plugin The plugin instance.
 * @param store The application state store.
 */
export function registerSystemEventListeners(plugin: VersionControlPlugin, store: AppStore): void {
    const services = ServiceRegistry.getInstance(plugin);
    const noteManager = services.noteManager;

    // 1. FILE-OPEN (Immediate, layout-aware)
    // Detect active file from focused leaf for multi-pane accuracy (v1.11+ stable).
    plugin.registerEvent(
        plugin.app.workspace.on('file-open', (_file: TFile | null) => {
            const activeLeaf = plugin.app.workspace.activeLeaf;
            // Pass the active leaf directly; the thunk handles extracting the file and context
            store.dispatch(thunks.initializeView(activeLeaf));
        })
    );

    // 2. METADATA CHANGES (Deferred, frequent during typing)
    // Stable metadataCache.on('changed') with timeout to ensure execution.
    plugin.registerEvent(
        plugin.app.metadataCache.on('changed', (file: TFile, _data: string, cache: CachedMetadata) => {
            if (noteManager.isInternalWrite(file.path) || noteManager.isPendingDeviation(file.path)) {
                return;
            }
            window.requestIdleCallback(() => {
                store.dispatch(thunks.handleMetadataChange(file, cache));
            }, { timeout: 1000 });
        })
    );

    // 3. VAULT MUTATIONS (Immediate, discrete user actions)
    // rename: Stable, includes TFolder handling if needed.
    plugin.registerEvent(
        plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile) {
                store.dispatch(thunks.handleFileRename(file, oldPath));
            }
        })
    );

    // delete: Stable, handles both files/folders.
    plugin.registerEvent(
        plugin.app.vault.on('delete', (file: TAbstractFile) => {
            store.dispatch(thunks.handleFileDelete(file));
        })
    );

    // create: Stable, extension-specific filtering.
    plugin.registerEvent(
        plugin.app.vault.on('create', (file: TAbstractFile) => {
            if (file instanceof TFile && file.extension === 'base') {
                store.dispatch(thunks.handleVaultSave(file));
            }
        })
    );

    // modify: Stable, guards against internal loops, targets relevant extensions.
    plugin.registerEvent(
        plugin.app.vault.on('modify', (file: TAbstractFile) => {
            if (!(file instanceof TFile)) return;
            const ext = file.extension;
            if ((ext === 'md' || ext === 'base') &&
                !noteManager.isInternalWrite(file.path) &&
                !noteManager.isPendingDeviation(file.path)) {
                store.dispatch(thunks.handleVaultSave(file));
            }
        })
    );
}
