import { App, TFile, Component, MarkdownView } from 'obsidian';
import type { Change } from 'diff';
import { sortBy, isString } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { wrap, releaseProxy, type Remote } from 'comlink';
import { VersionManager } from '../core/version-manager';
import type { DiffTarget, DiffWorkerApi, DiffType } from '../types';
import { PluginEvents } from '../core/plugin-events';
import { TYPES } from '../types/inversify.types';
import { LruCache } from '../utils/lru-cache';

const DIFF_CACHE_CAPACITY = 50;
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB limit
const WORKER_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// This global variable is expected to be defined by the build process at compile time 
// (e.g., using esbuild's `define` option). It will contain the bundled and minified
// code of the diff worker as a string.
declare const diffWorkerString: string;

/**
 * Enhanced error class for DiffManager operations
 */
class DiffManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'DiffManagerError';
    }
}

/**
 * Worker health monitor to track worker performance and reliability
 */
class WorkerHealthMonitor {
    private consecutiveErrors = 0;
    private lastErrorTime = 0;
    private operationCount = 0;
    private totalOperationTime = 0;
    private readonly maxConsecutiveErrors = 3;
    private readonly errorResetTime = 60000; // 1 minute

    recordOperation(duration: number): void {
        this.operationCount++;
        this.totalOperationTime += duration;
        
        // Reset error count on successful operation
        if (Date.now() - this.lastErrorTime > this.errorResetTime) {
            this.consecutiveErrors = 0;
        }
    }

    recordError(): void {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();
    }

    getAverageOperationTime(): number {
        return this.operationCount > 0 ? this.totalOperationTime / this.operationCount : 0;
    }

    isHealthy(): boolean {
        return this.consecutiveErrors < this.maxConsecutiveErrors;
    }

    getStats(): {
        consecutiveErrors: number;
        operationCount: number;
        averageOperationTime: number;
        isHealthy: boolean;
    } {
        return {
            consecutiveErrors: this.consecutiveErrors,
            operationCount: this.operationCount,
            averageOperationTime: this.getAverageOperationTime(),
            isHealthy: this.isHealthy()
        };
    }
}

@injectable()
export class DiffManager extends Component {
    private readonly diffCache: LruCache<string, Change[]>;
    private worker: Worker | null = null;
    private workerProxy: Remote<DiffWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private isTerminating = false;
    private isInitializing = false;
    private workerHealthMonitor = new WorkerHealthMonitor();
    private pendingOperations = new Set<Promise<any>>();

    constructor(
        @inject(TYPES.App) private readonly app: App, 
        @inject(TYPES.VersionManager) private readonly versionManager: VersionManager, 
        @inject(TYPES.EventBus) private readonly eventBus: PluginEvents
    ) {
        super();
        this.diffCache = new LruCache(DIFF_CACHE_CAPACITY, {
            maxKeySize: 500,
            operationTimeout: 5000
        });
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
            throw new DiffManagerError(
                `DiffManager initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'INIT_FAILED',
                { originalError: error }
            );
        }
    }

    private registerEventListeners(): void {
        const events = ['version-saved', 'version-deleted', 'history-deleted'] as const;
        
        for (const event of events) {
            this.eventBus.on(event, this.handleHistoryChange);
            this.register(() => this.eventBus.off(event, this.handleHistoryChange));
        }
    }

    private async initializeWorker(): Promise<void> {
        // Prevent re-initialization
        if (this.worker || this.isTerminating || this.isInitializing) {
            return;
        }

        this.isInitializing = true;

        try {
            // Validate worker code is available
            if (typeof diffWorkerString === 'undefined' || diffWorkerString === '') {
                throw new DiffManagerError(
                    "Diff worker code was not injected during the build process",
                    'WORKER_CODE_MISSING'
                );
            }

            // Create worker blob and URL
            const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);

            // Set up a general error handler for catastrophic failures
            this.worker.onerror = this.handleWorkerError.bind(this);
            
            // Wrap the worker with Comlink to get a typed proxy
            this.workerProxy = wrap<DiffWorkerApi>(this.worker);

            // Test worker with a simple operation
            await this.testWorker();

        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker", error);
            this.terminateWorker();
            throw new DiffManagerError(
                `Diff worker initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'WORKER_INIT_FAILED',
                { originalError: error }
            );
        } finally {
            this.isInitializing = false;
        }
    }

    private async testWorker(): Promise<void> {
        if (!this.workerProxy) {
            throw new DiffManagerError("Worker proxy not available for testing", 'WORKER_PROXY_MISSING');
        }

        try {
            // Test with a simple diff operation
            await this.workerProxy.computeDiff('lines', 'test', 'test');
        } catch (error) {
            throw new DiffManagerError(
                `Worker test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'WORKER_TEST_FAILED',
                { originalError: error }
            );
        }
    }

    private handleWorkerError(error: ErrorEvent): void {
        console.error("Version Control: Critical error in diff worker", {
            message: error.message,
            filename: error.filename,
            lineno: error.lineno,
            colno: error.colno
        });
        
        this.workerHealthMonitor.recordError();
        
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
        // Input validation
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new DiffManagerError("Invalid noteId: must be a non-empty string", 'INVALID_NOTE_ID');
        }
        
        if (!target || typeof target !== 'object') {
            throw new DiffManagerError("Invalid target: must be an object", 'INVALID_TARGET');
        }
        
        if (typeof target.id !== 'string' || target.id.trim() === '') {
            throw new DiffManagerError("Invalid target.id: must be a non-empty string", 'INVALID_TARGET_ID');
        }

        if (target.id === 'current') {
            if (!target.notePath || typeof target.notePath !== 'string') {
                throw new DiffManagerError("Current version requires a valid notePath", 'INVALID_NOTE_PATH');
            }
            
            const file = this.app.vault.getAbstractFileByPath(target.notePath);
            if (!(file instanceof TFile)) {
                throw new DiffManagerError(
                    `Could not find current note file at path "${target.notePath}"`,
                    'FILE_NOT_FOUND',
                    { notePath: target.notePath }
                );
            }
            
            if (!(await this.app.vault.adapter.exists(file.path))) {
                throw new DiffManagerError(
                    `Current note file does not exist at path "${file.path}"`,
                    'FILE_NOT_EXISTS',
                    { filePath: file.path }
                );
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
                throw new DiffManagerError(
                    `Could not retrieve content for version ${target.id}`,
                    'VERSION_CONTENT_NOT_FOUND',
                    { noteId, versionId: target.id }
                );
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
            throw new DiffManagerError("Invalid noteId: must be a non-empty string", 'INVALID_NOTE_ID');
        }
        if (typeof version1Id !== 'string' || version1Id.trim() === '') {
            throw new DiffManagerError("Invalid version1Id: must be a non-empty string", 'INVALID_VERSION_ID');
        }
        if (typeof version2Id !== 'string' || version2Id.trim() === '') {
            throw new DiffManagerError("Invalid version2Id: must be a non-empty string", 'INVALID_VERSION_ID');
        }
        if (typeof content1 !== 'string') {
            throw new DiffManagerError("Invalid content1: must be a string", 'INVALID_CONTENT');
        }
        if (typeof content2 !== 'string') {
            throw new DiffManagerError("Invalid content2: must be a string", 'INVALID_CONTENT');
        }
        if (typeof diffType !== 'string' || !['lines', 'words', 'chars', 'json'].includes(diffType)) {
            throw new DiffManagerError(
                `Invalid diffType: must be one of 'lines', 'words', 'chars', 'json'`,
                'INVALID_DIFF_TYPE'
            );
        }

        // Size validation
        if (content1.length > MAX_CONTENT_SIZE || content2.length > MAX_CONTENT_SIZE) {
            throw new DiffManagerError(
                `Content size exceeds maximum allowed size of ${MAX_CONTENT_SIZE} bytes`,
                'CONTENT_TOO_LARGE',
                { content1Size: content1.length, content2Size: content2.length }
            );
        }

        // JSON validation
        if (diffType === 'json') {
            try {
                JSON.parse(content1);
                JSON.parse(content2);
            } catch (jsonError) {
                throw new DiffManagerError(
                    `Invalid JSON input: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
                    'INVALID_JSON',
                    { originalError: jsonError }
                );
            }
        }

        // Sanitize content
        const sanitizedContent1 = this.sanitizeInput(content1);
        const sanitizedContent2 = this.sanitizeInput(content2);

        // Generate cache key
        const cacheKey = this.getCacheKey(noteId, version1Id, version2Id, diffType);

        // Return from cache if applicable
        if (version2Id !== 'current' && await this.diffCache.has(cacheKey)) {
            const cachedResult = await this.diffCache.get(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }
        }

        // Ensure worker is initialized
        if (!this.workerProxy) {
            await this.initializeWorker();
        }

        if (!this.workerProxy) {
            throw new DiffManagerError("Diff worker is not available after initialization attempt", 'WORKER_UNAVAILABLE');
        }

        // Check worker health
        if (!this.workerHealthMonitor.isHealthy()) {
            console.warn("Version Control: Worker health check failed, restarting worker");
            this.restartWorker();
            
            // Try again after restart
            if (!this.workerProxy) {
                await this.initializeWorker();
            }
            
            if (!this.workerProxy) {
                throw new DiffManagerError("Diff worker is not available after restart", 'WORKER_UNAVAILABLE');
            }
        }

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new DiffManagerError(
                `Diff operation timed out after ${WORKER_TIMEOUT}ms`,
                'OPERATION_TIMEOUT'
            )), WORKER_TIMEOUT);
        });

        // Create the diff operation with retry logic
        const diffOperation = this.createDiffOperationWithRetry(
            version2Id,
            sanitizedContent1,
            sanitizedContent2,
            diffType,
            cacheKey
        );

        try {
            // Race between the diff operation and timeout
            const changes = await Promise.race([diffOperation, timeoutPromise]);
            return changes;
        } catch (error) {
            this.workerHealthMonitor.recordError();
            
            if (error instanceof DiffManagerError) {
                throw error;
            }
            
            throw new DiffManagerError(
                `Diff calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'DIFF_CALCULATION_FAILED',
                { originalError: error }
            );
        }
    }

    private async createDiffOperationWithRetry(
        version2Id: string,
        content1: string,
        content2: string,
        diffType: DiffType,
        cacheKey: string
    ): Promise<Change[]> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const startTime = performance.now();
                
                // Call worker via Comlink proxy. Errors are automatically propagated.
                const changes = await this.workerProxy!.computeDiff(diffType, content1, content2);
                
                // Record operation time for health monitoring
                const duration = performance.now() - startTime;
                this.workerHealthMonitor.recordOperation(duration);
                
                // Validate the result
                this.validateDiffOutput(changes);
                
                // Cache result if not comparing with 'current'
                if (version2Id !== 'current') {
                    await this.diffCache.set(cacheKey, changes);
                }

                return changes;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                console.warn(`Version Control: Diff operation attempt ${attempt} failed`, lastError);
                
                // If this is not the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                    
                    // If the error suggests a worker communication issue, restart it
                    if (lastError.message.includes('could not be cloned') || 
                        lastError.message.includes('terminated') ||
                        lastError.message.includes('disconnected')) {
                        console.warn("Version Control: Worker communication failed. Restarting worker.");
                        this.restartWorker();
                    }
                }
            }
        }
        
        // All attempts failed
        throw new DiffManagerError(
            `Diff operation failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`,
            'DIFF_OPERATION_FAILED',
            { originalError: lastError }
        );
    }

    private sanitizeInput(input: string): string {
        // Replace problematic control characters, but preserve essential whitespace
        // like tab (\x09), newline (\x0A), and carriage return (\x0D).
        // The regex targets characters in the ranges \x00-\x08, \x0B, \x0C, \x0E-\x1F, and \x7F.
        return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    }
    
    private validateDiffOutput(changes: unknown): asserts changes is Change[] {
        if (!Array.isArray(changes)) {
            throw new DiffManagerError('Diff algorithm returned invalid result format: expected array', 'INVALID_DIFF_RESULT');
        }
    
        for (const change of changes) {
            if (!change || typeof change !== 'object') {
                throw new DiffManagerError('Invalid change object in diff result', 'INVALID_DIFF_RESULT');
            }
    
            const changeObj = change as Record<string, unknown>;
            if (!('value' in changeObj) || !('added' in changeObj) || !('removed' in changeObj)) {
                throw new DiffManagerError('Change object missing required properties', 'INVALID_DIFF_RESULT');
            }
    
            if (!isString(changeObj['value'])) {
                throw new DiffManagerError('Change value must be a string', 'INVALID_DIFF_RESULT');
            }
    
            if (typeof changeObj['added'] !== 'boolean' || typeof changeObj['removed'] !== 'boolean') {
                throw new DiffManagerError('Change added/removed flags must be boolean', 'INVALID_DIFF_RESULT');
            }
        }
    }

    private getCacheKey(noteId: string, id1: string, id2: string, diffType: DiffType): string {
        // Validate inputs
        if (typeof noteId !== 'string' || typeof id1 !== 'string' || typeof id2 !== 'string') {
            throw new DiffManagerError("Invalid parameters for cache key generation", 'INVALID_CACHE_KEY_PARAMS');
        }
        
        const sortedIds = sortBy([id1, id2]);
        return `${noteId}:${sortedIds[0]}:${sortedIds[1]}:${diffType}`;
    }

    public async invalidateCacheForNote(noteId: string): Promise<void> {
        if (typeof noteId !== 'string') {
            console.warn("Version Control: Attempted to invalidate cache with invalid noteId");
            return;
        }

        const prefix = `${noteId}:`;
        const keysToDelete: string[] = [];
        
        try {
            // Get all keys from the cache
            const keys = await this.diffCache.keys();
            
            for (const key of keys) {
                if (typeof key === 'string' && key.startsWith(prefix)) {
                    keysToDelete.push(key);
                }
            }
            
            // Delete the keys
            for (const key of keysToDelete) {
                await this.diffCache.delete(key);
            }
            
            if (keysToDelete.length > 0) {
                console.debug(`Version Control: Invalidated ${keysToDelete.length} cache entries for note ${noteId}`);
            }
        } catch (error) {
            console.error("Version Control: Error invalidating cache for note", error);
        }
    }

    private cleanup(): void {
        try {
            // Wait for all pending operations to complete
            Promise.allSettled(Array.from(this.pendingOperations))
                .then(() => {
                    this.terminateWorker();
                    return this.diffCache.clear();
                })
                .catch(error => {
                    console.error("Version Control: Error during cleanup", error);
                });
        } catch (error) {
            console.error("Version Control: Error during cleanup", error);
        }
    }

    // Public method to force worker restart
    public async restartWorker(): Promise<void> {
        try {
            this.terminateWorker();
            await this.initializeWorker();
        } catch (error) {
            console.error("Version Control: Error restarting worker", error);
            throw new DiffManagerError(
                `Worker restart failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'WORKER_RESTART_FAILED',
                { originalError: error }
            );
        }
    }

    // Public method to get current worker status
    public getWorkerStatus(): { 
        isInitialized: boolean; 
        isActive: boolean; 
        isHealthy: boolean;
        healthStats: {
            consecutiveErrors: number;
            operationCount: number;
            averageOperationTime: number;
        };
    } {
        return {
            isInitialized: this.worker !== null,
            isActive: this.workerProxy !== null && !this.isTerminating,
            isHealthy: this.workerHealthMonitor.isHealthy(),
            healthStats: {
                consecutiveErrors: this.workerHealthMonitor.getStats().consecutiveErrors,
                operationCount: this.workerHealthMonitor.getStats().operationCount,
                averageOperationTime: this.workerHealthMonitor.getStats().averageOperationTime
            }
        };
    }

    // Public method to get cache statistics
    public async getCacheStats(): Promise<{
        size: number;
        capacity: number;
        utilization: number;
    }> {
        try {
            return await this.diffCache.getStats();
        } catch (error) {
            console.error("Version Control: Error getting cache stats", error);
            return {
                size: 0,
                capacity: DIFF_CACHE_CAPACITY,
                utilization: 0
            };
        }
    }
}
