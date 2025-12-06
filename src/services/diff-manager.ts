import { App, TFile, Component, MarkdownView } from 'obsidian';
import { injectable, inject } from 'inversify';
import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import { z } from 'zod';
import { VersionManager } from '../core/version-manager';
import type { DiffTarget, DiffWorkerApi, DiffType, Change } from '../types';
import { ChangeSchema } from '../schemas';
import { PluginEvents } from '../core/plugin-events';
import { TYPES } from '../types/inversify.types';
import { LruCache } from '../utils/lru-cache';
import { VersionContentRepository } from '../core/storage/version-content-repository';

const DIFF_CACHE_CAPACITY = 50;
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB limit
const WORKER_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

declare const diffWorkerString: string;

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
    private decoder = new TextDecoder('utf-8');

    constructor(
        @inject(TYPES.App) private readonly app: App, 
        @inject(TYPES.VersionManager) private readonly versionManager: VersionManager,
        @inject(TYPES.VersionContentRepo) private readonly contentRepo: VersionContentRepository,
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
            this.registerEventListeners();
            this.initializeWorker();
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
        if (this.worker || this.isTerminating || this.isInitializing) {
            return;
        }

        this.isInitializing = true;

        try {
            if (typeof diffWorkerString === 'undefined' || diffWorkerString === '') {
                throw new DiffManagerError(
                    "Diff worker code was not injected during the build process",
                    'WORKER_CODE_MISSING'
                );
            }

            const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.worker.onerror = this.handleWorkerError.bind(this);
            this.workerProxy = wrap<DiffWorkerApi>(this.worker);
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
            const resultBuffer = await this.workerProxy.computeDiff('lines', 'test', 'test');
            const json = this.decoder.decode(resultBuffer);
            const changes = JSON.parse(json);
            if (!Array.isArray(changes)) throw new Error("Worker returned invalid data");
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
        this.terminateWorker();
    }

    private terminateWorker(): void {
        if (this.isTerminating) return;
        this.isTerminating = true;

        try {
            if (this.workerProxy) {
                this.workerProxy[releaseProxy]();
                this.workerProxy = null;
            }
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
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

    public async getContent(noteId: string, target: DiffTarget): Promise<string | ArrayBuffer> {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new DiffManagerError("Invalid noteId: must be a non-empty string", 'INVALID_NOTE_ID');
        }
        if (!target || typeof target !== 'object' || typeof target.id !== 'string' || target.id.trim() === '') {
            throw new DiffManagerError("Invalid target or target.id", 'INVALID_TARGET');
        }

        if (target.id === 'current') {
            if (!target.notePath || typeof target.notePath !== 'string') {
                throw new DiffManagerError("Current version requires a valid notePath", 'INVALID_NOTE_PATH');
            }
            
            const file = this.app.vault.getAbstractFileByPath(target.notePath);
            if (!(file instanceof TFile)) {
                throw new DiffManagerError(`Could not find current note file at path "${target.notePath}"`, 'FILE_NOT_FOUND');
            }
            
            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeMarkdownView?.file?.path === file.path && activeMarkdownView.getMode() === 'source') {
                return activeMarkdownView.editor.getValue();
            } else {
                // Optimize reading file on disk as binary for transfer
                return await this.app.vault.adapter.readBinary(file.path);
            }
        } else {
            // Try reading binary first for optimization
            const buffer = await this.contentRepo.readBinary(noteId, target.id);
            if (buffer) return buffer;

            // Fallback to string read via VersionManager if binary fails (e.g. legacy logic)
            const content = await this.versionManager.getVersionContent(noteId, target.id);
            if (content === null) {
                throw new DiffManagerError(`Could not retrieve content for version ${target.id}`, 'VERSION_CONTENT_NOT_FOUND');
            }
            return content;
        }
    }

    public async computeDiff(
        noteId: string,
        version1Id: string,
        version2Id: string,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        diffType: DiffType
    ): Promise<Change[]> {
        const params = { noteId, version1Id, version2Id, diffType };
        z.object({
            noteId: z.string().min(1),
            version1Id: z.string().min(1),
            version2Id: z.string().min(1),
            diffType: z.enum(['lines', 'words', 'chars', 'smart']),
        }).parse(params);

        const len1 = typeof content1 === 'string' ? content1.length : content1.byteLength;
        const len2 = typeof content2 === 'string' ? content2.length : content2.byteLength;

        if (len1 > MAX_CONTENT_SIZE || len2 > MAX_CONTENT_SIZE) {
            throw new DiffManagerError('Content size exceeds maximum allowed size', 'CONTENT_TOO_LARGE');
        }

        // We rely on the worker to sanitize, as we might be passing ArrayBuffers.
        const cacheKey = this.getCacheKey(noteId, version1Id, version2Id, diffType);

        if (version2Id !== 'current' && await this.diffCache.has(cacheKey)) {
            const cachedResult = await this.diffCache.get(cacheKey);
            if (cachedResult) return cachedResult;
        }

        if (!this.workerProxy) await this.initializeWorker();
        if (!this.workerProxy) throw new DiffManagerError("Diff worker unavailable", 'WORKER_UNAVAILABLE');

        if (!this.workerHealthMonitor.isHealthy()) {
            console.warn("Version Control: Worker health check failed, restarting worker");
            await this.restartWorker();
            if (!this.workerProxy) throw new DiffManagerError("Diff worker unavailable after restart", 'WORKER_UNAVAILABLE');
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new DiffManagerError('Diff operation timed out', 'OPERATION_TIMEOUT')), WORKER_TIMEOUT);
        });

        try {
            const diffOperation = this.createDiffOperationWithRetry(version2Id, content1, content2, diffType, cacheKey);
            return await Promise.race([diffOperation, timeoutPromise]);
        } catch (error) {
            this.workerHealthMonitor.recordError();
            throw error;
        }
    }

    private async createDiffOperationWithRetry(
        version2Id: string,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        diffType: DiffType,
        cacheKey: string
    ): Promise<Change[]> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Prepare transferables for this attempt
                let c1 = content1;
                let c2 = content2;
                
                // We need separate transfer lists for each argument to avoid DataCloneError (duplicates in transfer list)
                // if we were to use a shared list. Comlink handles arguments individually.
                const c1Transfer: Transferable[] = [];
                const c2Transfer: Transferable[] = [];

                if (content1 instanceof ArrayBuffer) {
                    // Create a copy for this attempt so the original buffer remains available for retries
                    c1 = content1.slice(0);
                    c1Transfer.push(c1 as ArrayBuffer);
                }
                if (content2 instanceof ArrayBuffer) {
                    c2 = content2.slice(0);
                    c2Transfer.push(c2 as ArrayBuffer);
                }

                const startTime = performance.now();
                
                // Call worker with transfer
                // Note: transfer() expects the value as first arg, and array of transferables as second.
                // We pass distinct transfer lists for each argument to prevent ambiguity or duplication issues in Comlink.
                const resultBuffer = await this.workerProxy!.computeDiff(
                    diffType, 
                    c1Transfer.length > 0 ? transfer(c1, c1Transfer) : c1, 
                    c2Transfer.length > 0 ? transfer(c2, c2Transfer) : c2
                );
                
                const duration = performance.now() - startTime;
                this.workerHealthMonitor.recordOperation(duration);
                
                // Deserialize result
                const json = this.decoder.decode(resultBuffer);
                const changes = JSON.parse(json);

                z.array(ChangeSchema).parse(changes);
                
                if (version2Id !== 'current') {
                    await this.diffCache.set(cacheKey, changes);
                }
                return changes;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Version Control: Diff operation attempt ${attempt} failed`, lastError);
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                    if (lastError.message.includes('cloned') || lastError.message.includes('terminated')) {
                        await this.restartWorker();
                    }
                }
            }
        }
        
        throw new DiffManagerError(`Diff operation failed after ${MAX_RETRIES} attempts`, 'DIFF_OPERATION_FAILED', { originalError: lastError });
    }

    private getCacheKey(noteId: string, id1: string, id2: string, diffType: DiffType): string {
        return `${noteId}:${id1}:${id2}:${diffType}`;
    }

    public async invalidateCacheForNote(noteId: string): Promise<void> {
        if (typeof noteId !== 'string' || noteId.trim() === '') return;

        const prefix = `${noteId}:`;
        const keysToDelete: string[] = [];
        
        try {
            const keys = await this.diffCache.keys();
            for (const key of keys) {
                if (typeof key === 'string' && key.startsWith(prefix)) {
                    keysToDelete.push(key);
                }
            }
            for (const key of keysToDelete) {
                await this.diffCache.delete(key);
            }
        } catch (error) {
            console.error("Version Control: Error invalidating cache for note", error);
        }
    }

    private cleanup(): void {
        Promise.allSettled(Array.from(this.pendingOperations))
            .then(() => {
                this.terminateWorker();
                return this.diffCache.clear();
            })
            .catch(error => console.error("Version Control: Error during cleanup", error));
    }

    public async restartWorker(): Promise<void> {
        try {
            this.terminateWorker();
            await this.initializeWorker();
        } catch (error) {
            console.error("Version Control: Error restarting worker", error);
            throw new DiffManagerError('Worker restart failed', 'WORKER_RESTART_FAILED', { originalError: error });
        }
    }

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
        const stats = this.workerHealthMonitor.getStats();
        return {
            isInitialized: this.worker !== null,
            isActive: this.workerProxy !== null && !this.isTerminating,
            isHealthy: stats.isHealthy,
            healthStats: {
                consecutiveErrors: stats.consecutiveErrors,
                operationCount: stats.operationCount,
                averageOperationTime: stats.averageOperationTime
            }
        };
    }

    public async getCacheStats(): Promise<{
        size: number;
        capacity: number;
        utilization: number;
    }> {
        try {
            const stats = await this.diffCache.getStats();
            return {
                size: stats.size,
                capacity: stats.capacity,
                utilization: stats.utilization,
            };
        } catch (error) {
            console.error("Version Control: Error getting cache stats", error);
            return { size: 0, capacity: DIFF_CACHE_CAPACITY, utilization: 0 };
        }
    }
}
