import 'reflect-metadata'; // Must be the first import
import { Plugin, WorkspaceLeaf } from 'obsidian';
import type { Debouncer } from 'obsidian';
import type { Container } from 'inversify';
import type { AppStore, AppState } from '@/state';
import { AppStatus, thunks } from '@/state';
import type { CleanupManager, BackgroundTaskManager, CentralManifestRepository, NoteManifestRepository, EditHistoryManager } from '@/core';
import type { QueueService } from '@/services';
import type { VersionControlSettings } from '@/types';
import { TYPES } from '@/types/inversify.types';
import { SettingsInitializer } from '@/main/initialization';
import { PluginLoader, PluginUnloader } from '@/main/lifecycle';
import type { DebouncerInfo, QueuedChangelogRequest } from '@/main/types';

/**
 * Main plugin class for Version Control.
 * Orchestrates initialization, lifecycle, and event handling through modular components.
 */
export default class VersionControlPlugin extends Plugin {
    public container!: Container;
    public store!: AppStore;
    public cleanupManager!: CleanupManager;
    public backgroundTaskManager!: BackgroundTaskManager;
    public debouncedLeafChangeHandler?: Debouncer<[WorkspaceLeaf | null], void>;
    public autoSaveDebouncers = new Map<string, DebouncerInfo>();
    private _isUnloading: boolean = false;
    public settings!: VersionControlSettings;
    private _initialized: boolean = false;
    private _unloadPromise: Promise<void> | null = null;

    /** Holds a request to show the changelog panel if the UI is not ready. */
    public queuedChangelogRequest: QueuedChangelogRequest | null = null;

    // Getter for isUnloading with type safety
    public get isUnloading(): boolean {
        return this._isUnloading;
    }

    // Setter for isUnloading with validation
    public set isUnloading(value: boolean) {
        if (typeof value !== 'boolean') {
            throw new TypeError('isUnloading must be a boolean');
        }
        this._isUnloading = value;
    }

    // Getter for initialization status
    public get initialized(): boolean {
        return this._initialized;
    }

    // Internal setter for initialization status
    public setInitialized(value: boolean): void {
        this._initialized = value;
    }

    override async onload() {
        const loader = new PluginLoader(this);
        await loader.load();
    }

    override async onunload() {
        // Prevent multiple unload operations
        if (this._unloadPromise) {
            return this._unloadPromise;
        }

        this._unloadPromise = this.performUnload();
        return this._unloadPromise;
    }

    private async performUnload(): Promise<void> {
        const unloader = new PluginUnloader(this);
        await unloader.unload();
    }

    /**
     * Saves settings to disk with validation.
     */
    async saveSettings(): Promise<void> {
        const settingsInitializer = new SettingsInitializer(this);
        await settingsInitializer.saveSettings();
    }

    /**
     * Handles store state changes, particularly for queued changelog requests.
     */
    public handleStoreChange(): void {
        if (this.isUnloading || !this.queuedChangelogRequest) {
            return;
        }

        const currentState = this.store.getState();

        const isChangelogReady = (state: AppState): boolean => {
            if (!state) return false;
            const isViewStable = state.status === AppStatus.INITIALIZING || state.status === AppStatus.READY || state.status === AppStatus.PLACEHOLDER || state.status === AppStatus.LOADING;
            const isPanelAvailable = !state.panel || state.panel.type === 'changelog';
            return isViewStable && isPanelAvailable;
        };

        if (isChangelogReady(currentState)) {
            // Use a timeout to avoid dispatching during a dispatch cycle.
            setTimeout(() => {
                if (this.isUnloading) return;
                // processQueuedChangelogRequest will clear the queue, so this only runs once per queued item.
                this.store.dispatch(thunks.processQueuedChangelogRequest());
            }, 0);
        }
    }

    /**
     * Cancels all debounced operations.
     */
    public cancelDebouncedOperations(): void {
        try {
            this.debouncedLeafChangeHandler?.cancel();
            this.autoSaveDebouncers.forEach(info => info.debouncer.cancel());
            this.autoSaveDebouncers.clear();
        } catch (error) {
            console.error("Version Control: Error cancelling debounced operations", error);
        }
    }

    /**
     * Completes any pending cleanup operations before shutdown.
     */
    public async completePendingOperations(): Promise<void> {
        try {
            // Ensure any critical, queued file operations are completed before shutdown.
            // This is wrapped in a try-catch to guarantee that the unload process continues
            // even if this step fails, which is critical for preventing resource leaks.
            if (this.cleanupManager) {
                await this.cleanupManager.completePendingCleanups();
            }
        } catch (error) {
            console.error("Version Control: Error while completing pending cleanups on unload.", error);
        }
    }

    /**
     * Cleans up the dependency injection container.
     */
    public async cleanupContainer(): Promise<void> {
        try {
            if (this.container) {
                // Get services that hold state but aren't components.
                const centralRepo = this.container.get<CentralManifestRepository>(TYPES.CentralManifestRepo);
                const noteRepo = this.container.get<NoteManifestRepository>(TYPES.NoteManifestRepo);
                const queueService = this.container.get<QueueService>(TYPES.QueueService);
                const editHistoryManager = this.container.get<EditHistoryManager>(TYPES.EditHistoryManager);

                // Invalidate caches and clear all pending task queues to prevent orphaned operations.
                if (centralRepo) centralRepo.invalidateCache();
                if (noteRepo) noteRepo.clearCache();
                if (queueService) queueService.clearAll();
                
                // Explicitly terminate EditHistoryManager to clear IDB cache and stop worker
                if (editHistoryManager) await editHistoryManager.terminate();

                // Unbind all services from the DI container. This is a crucial step to allow
                // the garbage collector to reclaim memory and prevent issues on plugin reload.
                this.container.unbindAll();
            }
        } catch (error) {
            // This might happen if the container failed to initialize or was already unbound.
            console.error("Version Control: Error during container cleanup on unload.", error);
        }
    }
}
