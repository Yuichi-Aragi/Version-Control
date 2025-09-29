import { App, TFile, Component, MarkdownView } from 'obsidian';
import type { Change } from 'diff';
import { sortBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { wrap, releaseProxy, type Remote } from 'comlink';
import { VersionManager } from '../core/version-manager';
import type { VersionHistoryEntry, DiffTarget, DiffWorkerApi, DiffType } from '../types';
import { PluginEvents } from '../core/plugin-events';
import { TYPES } from '../types/inversify.types';
import { LruCache } from '../utils/lru-cache';

const DIFF_CACHE_CAPACITY = 50;

// This global variable is expected to be defined by the build process at compile time 
// (e.g., using esbuild's `define` option). It will contain the bundled and minified
// code of the diff worker as a string.
declare const diffWorkerString: string;

@injectable()
export class DiffManager extends Component {
    private readonly diffCache: LruCache<string, Change[]>;
    private worker: Worker | null = null;
    private workerProxy: Remote<DiffWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private isTerminating = false;

    constructor(
        @inject(TYPES.App) private readonly app: App, 
        @inject(TYPES.VersionManager) private readonly versionManager: VersionManager, 
        @inject(TYPES.EventBus) private readonly eventBus: PluginEvents
    ) {
        super();
        this.diffCache = new LruCache(DIFF_CACHE_CAPACITY);
    }

    override onload(): void {
        try {
            // Register event listeners with cleanup
            this.registerEventListeners();
            
            // Initialize worker
            this.initializeWorker();
            
            // Register cleanup handlers
            this.register(() => this.cleanup());
        } catch (error) {
            console.error("Version Control: Failed to initialize DiffManager", error);
            this.cleanup();
            throw error;
        }
    }

    private registerEventListeners(): void {
        const events = ['version-saved', 'version-deleted', 'history-deleted'] as const;
        
        for (const event of events) {
            this.eventBus.on(event, this.handleHistoryChange);
            this.register(() => this.eventBus.off(event, this.handleHistoryChange));
        }
    }

    private initializeWorker(): void {
        // Prevent re-initialization
        if (this.worker || this.isTerminating) {
            return;
        }

        try {
            // Validate worker code is available
            if (typeof diffWorkerString === 'undefined' || diffWorkerString === '') {
                throw new Error("Diff worker code was not injected during the build process");
            }

            // Create worker blob and URL
            const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);

            // Set up a general error handler for catastrophic failures
            this.worker.onerror = this.handleWorkerError.bind(this);
            
            // Wrap the worker with Comlink to get a typed proxy
            this.workerProxy = wrap<DiffWorkerApi>(this.worker);

        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker", error);
            this.terminateWorker();
            throw new Error(`Diff worker initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private handleWorkerError(error: ErrorEvent): void {
        console.error("Version Control: Critical error in diff worker", {
            message: error.message,
            filename: error.filename,
            lineno: error.lineno,
            colno: error.colno
        });
        
        // The worker is likely unrecoverable. Terminate it.
        // It will be automatically restarted on the next `computeDiff` call.
        this.terminateWorker();
    }

    private terminateWorker(): void {
        if (this.isTerminating) return;
        this.isTerminating = true;

        try {
            // Release the Comlink proxy to free up memory
            if (this.workerProxy) {
                this.workerProxy[releaseProxy]();
                this.workerProxy = null;
            }

            // Terminate the actual worker
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }

            // Revoke the object URL to prevent memory leaks
            if (this.workerUrl) {
                URL.revokeObjectURL(this.workerUrl);
                this.workerUrl = null;
            }
        } catch (error) {
            console.error("Version Control: Error during worker termination", error);
        } finally {
            this.isTerminating = false;
        }
    }

    private handleHistoryChange = (noteId: string): void => {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            console.warn("Version Control: Received invalid noteId in handleHistoryChange");
            return;
        }
        this.invalidateCacheForNote(noteId);
    }

    public async getContent(noteId: string, target: DiffTarget): Promise<string> {
        if (target.id === 'current') {
            if (!target.notePath || typeof target.notePath !== 'string') {
                throw new Error("Current version requires a valid notePath");
            }
            
            const file = this.app.vault.getAbstractFileByPath(target.notePath);
            if (!(file instanceof TFile)) {
                throw new Error(`Could not find current note file at path "${target.notePath}"`);
            }
            
            if (!(await this.app.vault.adapter.exists(file.path))) {
                throw new Error(`Current note file does not exist at path "${file.path}"`);
            }
            
            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeMarkdownView?.file?.path === file.path) {
                return activeMarkdownView.editor.getValue();
            } else {
                return await this.app.vault.adapter.read(file.path);
            }
        } else {
            const content = await this.versionManager.getVersionContent(noteId, target.id);
            if (content === null) {
                throw new Error(`Could not retrieve content for version ${target.id}`);
            }
            return content;
        }
    }

    public async computeDiff(
        noteId: string,
        version1Id: string,
        version2Id: string,
        content1: string,
        content2: string,
        diffType: DiffType
    ): Promise<Change[]> {
        // Input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error("Invalid noteId: must be a non-empty string");
        }
        if (typeof version1Id !== 'string' || version1Id.trim() === '') {
            throw new Error("Invalid version1Id: must be a non-empty string");
        }
        if (typeof version2Id !== 'string' || version2Id.trim() === '') {
            throw new Error("Invalid version2Id: must be a non-empty string");
        }

        // Ensure worker is initialized
        if (!this.workerProxy) {
            this.initializeWorker();
        }

        if (!this.workerProxy) {
            throw new Error("Diff worker is not available after initialization attempt");
        }

        // Generate cache key
        const cacheKey = this.getCacheKey(noteId, version1Id, version2Id, diffType);

        // Return from cache if applicable
        if (version2Id !== 'current' && this.diffCache.has(cacheKey)) {
            const cachedResult = this.diffCache.get(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }
        }

        try {
            // Call worker via Comlink proxy. Errors are automatically propagated.
            const changes = await this.workerProxy.computeDiff(diffType, content1, content2);
            
            // Cache result if not comparing with 'current'
            if (version2Id !== 'current') {
                this.diffCache.set(cacheKey, changes);
            }

            return changes;

        } catch (error) {
            console.error("Version Control: Error generating diff via worker", error);
            // If the error suggests a worker communication issue, restart it for the next attempt.
            if (error instanceof Error && (error.message.includes('could not be cloned') || error.message.includes('terminated'))) {
                 console.error("Version Control: Worker communication failed. Restarting worker.");
                 this.restartWorker();
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    private getCacheKey(noteId: string, id1: string, id2: string, diffType: DiffType): string {
        // Validate inputs
        if (typeof noteId !== 'string' || typeof id1 !== 'string' || typeof id2 !== 'string') {
            throw new Error("Invalid parameters for cache key generation");
        }
        
        const sortedIds = sortBy([id1, id2]);
        return `${noteId}:${sortedIds[0]}:${sortedIds[1]}:${diffType}`;
    }

    public invalidateCacheForNote(noteId: string): void {
        if (typeof noteId !== 'string') {
            console.warn("Version Control: Attempted to invalidate cache with invalid noteId");
            return;
        }

        const prefix = `${noteId}:`;
        const keysToDelete: string[] = [];
        
        for (const key of this.diffCache.keys()) {
            if (typeof key === 'string' && key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.diffCache.delete(key);
        }
        
        if (keysToDelete.length > 0) {
            console.debug(`Version Control: Invalidated ${keysToDelete.length} cache entries for note ${noteId}`);
        }
    }

    private cleanup(): void {
        try {
            this.terminateWorker();
            this.diffCache.clear();
        } catch (error) {
            console.error("Version Control: Error during cleanup", error);
        }
    }

    // Public method to force worker restart
    public restartWorker(): void {
        this.terminateWorker();
        this.initializeWorker();
    }

    // Public method to get current worker status
    public getWorkerStatus(): { 
        isInitialized: boolean; 
        isActive: boolean; 
    } {
        return {
            isInitialized: this.worker !== null,
            isActive: this.workerProxy !== null && !this.isTerminating,
        };
    }
}
