import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import type { WorkerHealthStats } from './types';

/**
 * Configuration options for WorkerManager initialization.
 */
export interface WorkerManagerConfig {
    /** The worker code string injected during build */
    workerString: string;
    /** Human-readable name for error messages and logging */
    workerName: string;
    /** Whether to validate worker on initialization (default: true) */
    validateOnInit?: boolean;
    /** Maximum consecutive errors before worker is considered unhealthy (default: 3) */
    maxConsecutiveErrors?: number;
    /** Time window in ms to reset consecutive error count (default: 60000) */
    errorResetTime?: number;
}

/**
 * Result of worker initialization.
 */
export interface WorkerInitResult {
    success: boolean;
    error?: Error;
}

/**
 * Centralized worker lifecycle manager that eliminates code duplication
 * across multiple worker clients (diff, compression, timeline, edit-history).
 * 
 * Performance optimizations:
 * - Blob URL reuse (no repeated URL.createObjectURL calls)
 * - Efficient proxy management with Comlink
 * - Minimized state checks in hot paths
 * - Transferable-aware operations for zero-copy data transfer
 * 
 * Features:
 * - Unified initialization and termination
 * - Health monitoring with configurable thresholds
 * - Lazy initialization with ensureWorker() pattern
 * - Worker validation on startup
 * - Proper resource cleanup (Blob URLs, proxies, workers)
 * - Error tracking and recovery support
 * 
 * @example
 * ```typescript
 * const manager = new WorkerManager({
 *     workerString: diffWorkerString,
 *     workerName: 'Diff Worker',
 *     validateOnInit: true
 * });
 * 
 * const proxy = manager.ensureWorker();
 * const result = await proxy.computeDiff('lines', content1, content2);
 * ```
 */
export class WorkerManager<TApi = unknown> {
    protected worker: Worker | null = null;
    protected workerProxy: Remote<TApi> | null = null;
    protected workerUrl: string | null = null;
    protected isTerminated = false;
    protected isInitializing = false;
    
    // Health monitoring
    private consecutiveErrors = 0;
    private lastErrorTime = 0;
    private operationCount = 0;
    private totalOperationTime = 0;
    
    // Configuration
    private readonly workerString: string;
    private readonly workerName: string;
    private readonly validateOnInit: boolean;
    private readonly maxConsecutiveErrors: number;
    private readonly errorResetTime: number;

    /**
     * Creates a new WorkerManager instance.
     * @param config Configuration options for the worker manager
     */
    constructor(config: WorkerManagerConfig) {
        this.workerString = config.workerString;
        this.workerName = config.workerName;
        this.validateOnInit = config.validateOnInit ?? true;
        this.maxConsecutiveErrors = config.maxConsecutiveErrors ?? 3;
        this.errorResetTime = config.errorResetTime ?? 60000;
    }

    /**
     * Initializes the worker synchronously if not already initialized.
     * Safe to call multiple times - will be a no-op after first successful init.
     */
    public initialize(): void {
        if (this.isTerminated) {
            throw new WorkerManagerError(
                `${this.workerName} has been terminated`,
                'INVALID_STATE'
            );
        }
        
        if (this.worker !== null) return;

        this.createWorker();
    }

    /**
     * Ensures the worker is initialized and ready for use.
     * Throws if worker cannot be initialized.
     * @returns The worker proxy for making API calls
     * @throws WorkerManagerError if worker is terminated or unavailable
     */
    public ensureWorker(): Remote<TApi> {
        if (this.isTerminated) {
            throw new WorkerManagerError(
                `${this.workerName} has been terminated`,
                'WORKER_UNAVAILABLE'
            );
        }
        
        if (this.workerProxy === null) {
            this.createWorker();
        }
        
        if (this.workerProxy === null) {
            throw new WorkerManagerError(
                `${this.workerName} not available`,
                'WORKER_UNAVAILABLE'
            );
        }
        
        return this.workerProxy;
    }

    /**
     * Initializes the worker asynchronously with validation.
     * Use this when you need to await the initialization result.
     * @returns Promise resolving when worker is ready
     * @throws WorkerManagerError if initialization fails
     */
    public async initializeAsync(): Promise<void> {
        if (this.isTerminated) {
            throw new WorkerManagerError(
                `${this.workerName} has been terminated`,
                'INVALID_STATE'
            );
        }
        
        if (this.worker !== null || this.isInitializing) {
            return;
        }

        this.isInitializing = true;
        
        try {
            this.createWorker();
            
            if (this.validateOnInit && this.workerProxy !== null) {
                await this.validateWorker();
            }
        } catch (error) {
            this.terminate();
            throw new WorkerManagerError(
                `${this.workerName} initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'INIT_FAILED',
                { originalError: error }
            );
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Creates the worker and proxy. Internal method.
     * Reuses Blob URL for efficiency.
     */
    protected createWorker(): void {
        if (this.worker !== null) return;

        if (typeof this.workerString === 'undefined' || this.workerString === '') {
            console.error(`Version Control: ${this.workerName} code missing.`);
            return;
        }

        try {
            const blob = new Blob([this.workerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.workerProxy = wrap<TApi>(this.worker);
        } catch (error) {
            console.error(`Version Control: Failed to initialize ${this.workerName}`, error);
            this.cleanupResources();
            throw new WorkerManagerError(
                'Worker creation failed',
                'WORKER_CREATION_FAILED',
                { originalError: error }
            );
        }
    }

    /**
     * Validates that the worker is functioning correctly.
     * Override this in subclasses to implement worker-specific validation.
     * @throws Error if validation fails
     */
    protected async validateWorker(): Promise<void> {
        // Default implementation does nothing
        // Subclasses can override to implement worker-specific tests
    }

    /**
     * Records a successful operation for health monitoring.
     * @param duration The duration of the operation in milliseconds
     */
    public recordOperation(duration: number): void {
        this.operationCount++;
        this.totalOperationTime += duration;

        // Reset error count if enough time has passed since last error
        if (Date.now() - this.lastErrorTime > this.errorResetTime) {
            this.consecutiveErrors = 0;
        }
    }

    /**
     * Records an error for health monitoring.
     */
    public recordError(): void {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();
    }

    /**
     * Gets the current health statistics.
     * @returns WorkerHealthStats object with current health metrics
     */
    public getHealthStats(): WorkerHealthStats {
        return {
            consecutiveErrors: this.consecutiveErrors,
            operationCount: this.operationCount,
            averageOperationTime: this.operationCount > 0 
                ? this.totalOperationTime / this.operationCount 
                : 0,
            isHealthy: this.consecutiveErrors < this.maxConsecutiveErrors
        };
    }

    /**
     * Checks if the worker is currently healthy.
     * @returns true if worker is healthy, false otherwise
     */
    public isHealthy(): boolean {
        return this.consecutiveErrors < this.maxConsecutiveErrors;
    }

    /**
     * Terminates the worker and releases all resources.
     * Safe to call multiple times.
     */
    public terminate(): void {
        if (this.isTerminated) return;
        
        this.isTerminated = true;
        this.cleanupResources();
    }

    /**
     * Cleans up worker resources without setting terminated flag.
     * Used internally and can be called during error recovery.
     */
    protected cleanupResources(): void {
        if (this.workerProxy !== null) {
            try {
                // Type assertion to access the releaseProxy symbol
                const releaseProxySymbol = releaseProxy as unknown as string;
                const releaseFn = (this.workerProxy as unknown as Record<string, () => void | undefined>)[releaseProxySymbol];
                if (releaseFn !== undefined) {
                    releaseFn();
                }
            } catch {
                // Ignore cleanup errors for proxy release
            }
            this.workerProxy = null;
        }

        if (this.worker !== null) {
            this.worker.terminate();
            this.worker = null;
        }

        if (this.workerUrl !== null) {
            URL.revokeObjectURL(this.workerUrl);
            this.workerUrl = null;
        }
    }

    /**
     * Restarts the worker by terminating and reinitializing.
     * @returns Promise resolving when worker is ready again
     */
    public async restart(): Promise<void> {
        this.cleanupResources();
        this.consecutiveErrors = 0;
        this.lastErrorTime = 0;
        
        await this.initializeAsync();
    }

    /**
     * Checks if the worker has been terminated.
     * @returns true if terminated, false otherwise
     */
    public isTerminatedState(): boolean {
        return this.isTerminated;
    }

    /**
     * Checks if the worker has been initialized.
     * @returns true if worker exists, false otherwise
     */
    public isInitialized(): boolean {
        return this.worker !== null;
    }

    /**
     * Checks if the worker is currently active (initialized and not terminated).
     * @returns true if active, false otherwise
     */
    public isActive(): boolean {
        return this.worker !== null && !this.isTerminated;
    }

    /**
     * Gets the current worker status for debugging/monitoring.
     * @returns Object with all status information
     */
    public getStatus(): {
        isInitialized: boolean;
        isActive: boolean;
        isHealthy: boolean;
        healthStats: WorkerHealthStats;
    } {
        const stats = this.getHealthStats();
        return {
            isInitialized: this.isInitialized(),
            isActive: this.isActive(),
            isHealthy: stats.isHealthy,
            healthStats: stats
        };
    }
}

/**
 * Error class for worker manager operations.
 */
export class WorkerManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'WorkerManagerError';
    }
}

/**
 * Utility function to prepare transferables for ArrayBuffer arguments.
 * Wraps content in Comlink.transfer() if it's an ArrayBuffer for zero-copy transfer.
 * 
 * @param content The content to prepare for transfer
 * @param transfers Array to push transferables into
 * @returns The original content or wrapped transfer
 * 
 * @example
 * ```typescript
 * const transfers: ArrayBuffer[] = [];
 * const result = prepareTransferable(content, transfers);
 * // If content is ArrayBuffer, it's now wrapped for zero-copy transfer
 * ```
 */
export function prepareTransferable(
    content: string | ArrayBuffer,
    transfers: ArrayBuffer[]
): string | ArrayBuffer {
    if (content instanceof ArrayBuffer) {
        transfers.push(content);
        return transfer(content, transfers);
    }
    return content;
}
