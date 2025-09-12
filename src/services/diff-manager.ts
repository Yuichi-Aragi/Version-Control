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
    private diffCache: LruCache<string, Change[]>;
    private worker: Worker | null = null;
    private workerUrl: string | null = null;
    private requests = new Map<string, { resolve: (changes: Change[]) => void; reject: (error: Error) => void }>();

    constructor(
        @inject(TYPES.App) private app: App, 
        @inject(TYPES.VersionManager) private versionManager: VersionManager, 
        @inject(TYPES.EventBus) private eventBus: PluginEvents
    ) {
        super();
        this.diffCache = new LruCache(DIFF_CACHE_CAPACITY);
    }

    override onload() {
        this.eventBus.on('version-saved', this.handleHistoryChange);
        this.register(() => this.eventBus.off('version-saved', this.handleHistoryChange));

        this.eventBus.on('version-deleted', this.handleHistoryChange);
        this.register(() => this.eventBus.off('version-deleted', this.handleHistoryChange));

        this.eventBus.on('history-deleted', this.handleHistoryChange);
        this.register(() => this.eventBus.off('history-deleted', this.handleHistoryChange));

        // Initialize the persistent worker on load.
        this.initializeWorker();

        // Register cleanup for the worker and cache.
        this.register(() => this.terminateWorker());
        this.register(() => this.diffCache.clear());
    }

    private initializeWorker(): void {
        // Prevent re-initialization.
        if (this.worker) {
            return;
        }

        try {
            // The build process is expected to replace `diffWorkerString` with the actual worker code.
            // If it's not available or empty, the diff functionality cannot work.
            if (typeof diffWorkerString === 'undefined' || diffWorkerString === '') {
                console.error("Version Control: Diff worker code was not injected during the build process. Diff functionality will be disabled.");
                this.terminateWorker(); // Ensure cleanup
                return;
            }

            const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);

            this.worker.onmessage = (event: MessageEvent<DiffWorkerResponse>) => {
                const { requestId } = event.data;
                const promise = this.requests.get(requestId);

                if (!promise) {
                    console.warn(`Version Control: Received a diff response for an unknown request ID: ${requestId}`);
                    return;
                }

                if (event.data.status === 'success') {
                    promise.resolve(event.data.changes);
                } else {
                    const error = new Error(event.data.error.message);
                    // Conditionally assign stack to comply with `exactOptionalPropertyTypes`
                    if (event.data.error.stack) {
                        error.stack = event.data.error.stack;
                    }
                    promise.reject(error);
                }
                this.requests.delete(requestId);
            };

            this.worker.onerror = (error: ErrorEvent) => {
                console.error("Version Control: A critical error occurred in the diff worker.", error);
                // Reject all pending requests as the worker is now in an unknown state.
                for (const [requestId, { reject }] of this.requests.entries()) {
                    reject(new Error(`The diff worker encountered a critical error: ${error.message}`));
                }
                this.requests.clear();
                // Attempt to restart the worker on the next call.
                this.terminateWorker();
            };

            this.worker.onmessageerror = (event: MessageEvent) => {
                console.error("Version Control: A message error occurred in the diff worker.", event);
            };

        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker.", error);
            // Ensure any partial initialization is cleaned up.
            this.terminateWorker();
        }
    }

    private terminateWorker(): void {
        if (this.worker) {
            // Reject any outstanding requests because they will never be fulfilled.
            for (const { reject } of this.requests.values()) {
                reject(new Error("The diff worker is being terminated."));
            }
            this.requests.clear();

            this.worker.terminate();
            this.worker = null;
        }
        
        // FIX: Use a non-null assertion operator (!) to override the compiler's incorrect
        // type inference. The preceding `if` statement guarantees that `this.workerUrl`
        // is a string at this point, making this assertion safe. This is a targeted
        // workaround for a persistent and unusual compiler error.
        if (this.workerUrl) {
            URL.revokeObjectURL(this.workerUrl!);
        }
        this.workerUrl = null;
    }

    private handleHistoryChange = (noteId: string): void => {
        this.invalidateCacheForNote(noteId);
    }

    public generateDiff(
        noteId: string,
        version1: VersionHistoryEntry,
        version2: DiffTarget
    ): Promise<Change[]> {
        // Lazily initialize the worker if it's not already running.
        // This provides robustness if the initial `onload` initialization failed.
        if (!this.worker) {
            this.initializeWorker();
        }

        if (!this.worker) {
            return Promise.reject(new Error("Diff worker is not available."));
        }

        return new Promise<Change[]>(async (resolve, reject) => {
            try {
                const cacheKey = this.getCacheKey(noteId, version1.id, version2.id);

                if (version2.id !== 'current' && this.diffCache.has(cacheKey)) {
                    resolve(this.diffCache.get(cacheKey)!);
                    return;
                }

                const content1 = await this.versionManager.getVersionContent(noteId, version1.id);
                let content2: string | null;

                if (version2.id === 'current') {
                    const file = this.app.vault.getAbstractFileByPath(version2.notePath);
                    if (file instanceof TFile) {
                        // To get the most accurate "current" state, we prioritize the active editor's
                        // content. If the note isn't active, we read directly from disk via the
                        // adapter to bypass any potentially stale cache.
                        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeMarkdownView?.file?.path === file.path) {
                            content2 = activeMarkdownView.editor.getValue();
                        } else {
                            if (!(await this.app.vault.adapter.exists(file.path))) {
                                throw new Error(`Could not find the current note file at path "${file.path}" to generate diff.`);
                            }
                            content2 = await this.app.vault.adapter.read(file.path);
                        }
                    } else {
                        throw new Error(`Could not find the current note file at path "${version2.notePath}" to generate diff.`);
                    }
                } else {
                    content2 = await this.versionManager.getVersionContent(noteId, version2.id);
                }

                if (content1 === null || content2 === null) {
                    throw new Error("Could not retrieve content for one or both versions.");
                }

                const requestId = generateUniqueId();
                this.requests.set(requestId, {
                    resolve: (changes: Change[]) => {
                        // Cache the result if it's not against the 'current' state.
                        if (version2.id !== 'current') {
                            this.diffCache.set(cacheKey, changes);
                        }
                        resolve(changes);
                    },
                    reject,
                });

                // Post the message to the persistent worker.
                this.worker!.postMessage({
                    requestId,
                    content1,
                    content2,
                });

            } catch (error) {
                console.error("Version Control: Error setting up diff request", error);
                reject(error);
            }
        });
    }

    private getCacheKey(noteId: string, id1: string, id2: string): string {
        const sortedIds = sortBy([id1, id2]);
        return `${noteId}:${sortedIds[0]}:${sortedIds[1]}`;
    }

    public invalidateCacheForNote(noteId: string): void {
        const keysToDelete = [];
        for (const key of this.diffCache.keys()) {
            if (key.startsWith(`${noteId}:`)) {
                keysToDelete.push(key);
            }
        }
        if (keysToDelete.length > 0) {
            keysToDelete.forEach(key => this.diffCache.delete(key));
        }
    }
}
