import { App, TFile, Component, MarkdownView } from 'obsidian';
import type { Change } from 'diff';
import { sortBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { VersionManager } from '../core/version-manager';
import type { VersionHistoryEntry, DiffTarget } from '../types';
import { PluginEvents } from '../core/plugin-events';
import { TYPES } from '../types/inversify.types';
import { generateUniqueId } from '../utils/id';
import { LruCache } from '../utils/lru-cache';

// Define response types to match the worker
interface DiffWorkerSuccessResponse {
    status: 'success';
    requestId: string;
    changes: Change[];
}

interface DiffWorkerErrorResponse {
    status: 'error';
    requestId: string;
    error: {
        message: string;
        stack?: string;
    };
}

type DiffWorkerResponse = DiffWorkerSuccessResponse | DiffWorkerErrorResponse;

const DIFF_CACHE_CAPACITY = 50;

// This global variable is expected to be defined by the build process 
// (e.g., using esbuild's `define` option). It will contain the bundled and minified
// code of the diff worker as a string.
declare const diffWorkerString: string;

@injectable()
export class DiffManager extends Component {
    private readonly diffCache: LruCache<string, Change[]>;
    private worker: Worker | null = null;
    private workerUrl: string | null = null;
    private readonly requests = new Map<string, { resolve: (changes: Change[]) => void; reject: (error: Error) => void }>();
    private isTerminating = false;
    private readonly MAX_CONCURRENT_REQUESTS = 10;
    private activeRequests = 0;

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

            // Set up message handler
            this.worker.onmessage = this.handleWorkerMessage.bind(this);

            // Set up error handlers
            this.worker.onerror = this.handleWorkerError.bind(this);
            this.worker.onmessageerror = this.handleWorkerMessageError.bind(this);

        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker", error);
            this.terminateWorker();
            throw new Error(`Diff worker initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private handleWorkerMessage(event: MessageEvent<DiffWorkerResponse>): void {
        const data = event.data;
        
        // Validate message structure
        if (!data || typeof data !== 'object' || !('requestId' in data) || !('status' in data)) {
            console.warn("Version Control: Received malformed message from diff worker");
            return;
        }

        const { requestId } = data;
        const promise = this.requests.get(requestId);

        if (!promise) {
            console.warn(`Version Control: Received diff response for unknown request ID: ${requestId}`);
            return;
        }

        try {
            if (data.status === 'success') {
                if (!Array.isArray(data.changes)) {
                    throw new Error("Invalid response format: changes must be an array");
                }
                promise.resolve(data.changes);
            } else {
                const errorMessage = data.error?.message || "Unknown error from worker";
                const error = new Error(errorMessage);
                if (data.error?.stack) {
                    error.stack = data.error.stack;
                }
                promise.reject(error);
            }
        } catch (error) {
            console.error("Version Control: Error processing worker response", error);
            promise.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.requests.delete(requestId);
            this.activeRequests = Math.max(0, this.activeRequests - 1);
        }
    }

    private handleWorkerError(error: ErrorEvent): void {
        console.error("Version Control: Critical error in diff worker", {
            message: error.message,
            filename: error.filename,
            lineno: error.lineno,
            colno: error.colno
        });

        // Reject all pending requests
        for (const [, { reject }] of this.requests.entries()) {
            reject(new Error(`Diff worker encountered a critical error: ${error.message}`));
        }
        this.requests.clear();
        this.activeRequests = 0;
        
        // Terminate and attempt to restart on next request
        this.terminateWorker();
    }

    private handleWorkerMessageError(event: MessageEvent): void {
        console.error("Version Control: Message error in diff worker", event);
    }

    private terminateWorker(): void {
        if (this.isTerminating) return;
        this.isTerminating = true;

        try {
            // Reject outstanding requests
            for (const { reject } of this.requests.values()) {
                reject(new Error("Diff worker is being terminated"));
            }
            this.requests.clear();
            this.activeRequests = 0;

            // Terminate worker
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }

            // Revoke object URL
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

    public async generateDiff(
        noteId: string,
        version1: VersionHistoryEntry,
        version2: DiffTarget
    ): Promise<Change[]> {
        // Input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error("Invalid noteId: must be a non-empty string");
        }
        
        if (!version1 || typeof version1.id !== 'string' || version1.id.trim() === '') {
            throw new Error("Invalid version1: must have a valid id");
        }
        
        if (!version2 || typeof version2.id !== 'string' || version2.id.trim() === '') {
            throw new Error("Invalid version2: must have a valid id");
        }

        // Check for rate limiting
        if (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
            throw new Error(`Too many concurrent diff requests (${this.activeRequests}/${this.MAX_CONCURRENT_REQUESTS})`);
        }

        // Ensure worker is initialized
        if (!this.worker) {
            this.initializeWorker();
        }

        if (!this.worker) {
            throw new Error("Diff worker is not available after initialization attempt");
        }

        // Generate cache key
        const cacheKey = this.getCacheKey(noteId, version1.id, version2.id);

        // Return from cache if applicable
        if (version2.id !== 'current' && this.diffCache.has(cacheKey)) {
            const cachedResult = this.diffCache.get(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }
        }

        // Increment active requests counter
        this.activeRequests++;

        try {
            // Get content for version1
            const content1 = await this.versionManager.getVersionContent(noteId, version1.id);
            if (content1 === null) {
                throw new Error(`Could not retrieve content for version ${version1.id}`);
            }

            // Get content for version2
            let content2: string;
            
            if (version2.id === 'current') {
                if (!version2.notePath || typeof version2.notePath !== 'string') {
                    throw new Error("Current version requires a valid notePath");
                }
                
                const file = this.app.vault.getAbstractFileByPath(version2.notePath);
                if (!(file instanceof TFile)) {
                    throw new Error(`Could not find current note file at path "${version2.notePath}"`);
                }
                
                // Check if file exists
                if (!(await this.app.vault.adapter.exists(file.path))) {
                    throw new Error(`Current note file does not exist at path "${file.path}"`);
                }
                
                // Get content from active editor or read from disk
                const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeMarkdownView?.file?.path === file.path) {
                    content2 = activeMarkdownView.editor.getValue();
                } else {
                    content2 = await this.app.vault.adapter.read(file.path);
                }
            } else {
                const retrievedContent2 = await this.versionManager.getVersionContent(noteId, version2.id);
                if (retrievedContent2 === null) {
                    throw new Error(`Could not retrieve content for version ${version2.id}`);
                }
                content2 = retrievedContent2;
            }

            // Validate content
            if (typeof content1 !== 'string' || typeof content2 !== 'string') {
                throw new Error("Retrieved content is not a string");
            }

            // Create request promise
            const requestId = generateUniqueId();
            const requestPromise = new Promise<Change[]>((resolve, reject) => {
                this.requests.set(requestId, {
                    resolve: (changes: Change[]) => {
                        // Validate changes array
                        if (!Array.isArray(changes)) {
                            reject(new Error("Worker returned invalid changes format"));
                            return;
                        }
                        
                        // Cache result if not comparing with 'current'
                        if (version2.id !== 'current') {
                            this.diffCache.set(cacheKey, changes);
                        }
                        resolve(changes);
                    },
                    reject: (error: Error) => {
                        reject(error);
                    },
                });
            });

            // Post message to worker
            try {
                this.worker.postMessage({
                    requestId,
                    content1,
                    content2,
                });
            } catch (error) {
                // Clean up request if posting fails
                this.requests.delete(requestId);
                this.activeRequests = Math.max(0, this.activeRequests - 1);
                throw new Error(`Failed to send message to worker: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Return the promise
            return requestPromise;

        } catch (error) {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
            console.error("Version Control: Error generating diff", error);
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    private getCacheKey(noteId: string, id1: string, id2: string): string {
        // Validate inputs
        if (typeof noteId !== 'string' || typeof id1 !== 'string' || typeof id2 !== 'string') {
            throw new Error("Invalid parameters for cache key generation");
        }
        
        const sortedIds = sortBy([id1, id2]);
        return `${noteId}:${sortedIds[0]}:${sortedIds[1]}`;
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
            this.requests.clear();
            this.activeRequests = 0;
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
        pendingRequests: number;
        activeRequests: number;
    } {
        return {
            isInitialized: this.worker !== null,
            isActive: this.worker !== null && !this.isTerminating,
            pendingRequests: this.requests.size,
            activeRequests: this.activeRequests
        };
    }
}