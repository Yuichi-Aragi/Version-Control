import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import type { WorkerHealthStats, WorkerExecutionOptions } from './types';

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
 * Centralized worker lifecycle manager that eliminates code duplication
 * across multiple worker clients.
 * 
 * Features:
 * - Robust error handling and automatic recovery
 * - Timeout management
 * - Zero-copy transfer support
 * - Health monitoring
 * - Thread-safe initialization
 */
export class WorkerManager<TApi = unknown> {
    protected worker: Worker | null = null;
    protected workerProxy: Remote<TApi> | null = null;
    protected workerUrl: string | null = null;
    
    // State flags
    protected isTerminated = false;
    protected isInitializing = false;
    private initPromise: Promise<void> | null = null;
    
    // Health monitoring
    private consecutiveErrors = 0;
    private lastErrorTime = 0;
    private lastSuccessTime = 0;
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
     * Executes a function using the worker API with robust error handling,
     * timeouts, and automatic retries.
     * 
     * @param operation Function that takes the worker proxy and returns a promise
     * @param options Execution options (timeout, retries)
     * @returns The result of the operation
     */
    public async execute<T>(
        operation: (api: Remote<TApi>) => Promise<T> | T,
        options: WorkerExecutionOptions = {}
    ): Promise<T> {
        const { 
            timeout = 30000, 
            retry = true, 
            retryAttempts = 1,
            forceRestart = false 
        } = options;

        // 1. Check Termination State (Fast Fail)
        if (this.isTerminated) {
            throw new WorkerManagerError(
                `${this.workerName} has been terminated`,
                'WORKER_UNAVAILABLE'
            );
        }

        // 2. Force Restart if requested
        if (forceRestart) {
            await this.restart();
        }

        // 3. Ensure Worker is Ready (Lazy Init)
        try {
            if (!this.workerProxy) {
                await this.initializeAsync();
            }
        } catch (e) {
            // If init fails, we can't proceed
            throw new WorkerManagerError(
                `Failed to initialize ${this.workerName} for execution`,
                'INIT_FAILED',
                { originalError: e }
            );
        }

        const startTime = performance.now();

        try {
            // 4. Execute with Timeout
            const result = await this.runWithTimeout(
                () => operation(this.workerProxy!), 
                timeout
            );
            
            // 5. Success Handling
            this.recordOperation(performance.now() - startTime);
            return result;

        } catch (error) {
            // 6. Error Handling & Retry Logic
            this.recordError();
            
            const isRetryable = retry && retryAttempts > 0 && this.isRetryableError(error);
            
            if (isRetryable && !this.isTerminated) {
                console.warn(`Version Control: Retrying ${this.workerName} operation after error:`, error);
                
                // Force a clean restart before retry to clear bad state
                await this.restart();
                
                // Recursive retry with decremented attempts
                return this.execute(operation, {
                    ...options,
                    retryAttempts: retryAttempts - 1,
                    forceRestart: false // Already restarted
                });
            }

            // Transform error if needed
            if (error instanceof WorkerManagerError) throw error;
            
            throw new WorkerManagerError(
                `${this.workerName} operation failed: ${error instanceof Error ? error.message : String(error)}`,
                'OPERATION_FAILED',
                { originalError: error }
            );
        }
    }

    /**
     * Helper to run a promise with a timeout.
     */
    private runWithTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number): Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            let timer: number | undefined;
            
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, rejectTimeout) => {
                timer = window.setTimeout(() => {
                    rejectTimeout(new WorkerManagerError(
                        `${this.workerName} operation timed out after ${timeoutMs}ms`,
                        'OPERATION_TIMEOUT'
                    ));
                }, timeoutMs);
            });

            try {
                // Race execution against timeout
                const result = await Promise.race([
                    Promise.resolve(fn()),
                    timeoutPromise
                ]);
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
            }
        });
    }

    /**
     * Determines if an error suggests the worker should be restarted and the operation retried.
     */
    private isRetryableError(error: unknown): boolean {
        if (this.isTerminated) return false;
        
        const msg = error instanceof Error ? error.message : String(error);
        
        // Comlink/Worker specific errors indicating disconnection or crash
        if (msg.includes('Proxy has been released')) return true;
        if (msg.includes('MessagePort was closed')) return true;
        if (msg.includes('The worker has been terminated')) return true;
        
        // Timeout is retryable (worker might have been just temporarily stuck)
        if (error instanceof WorkerManagerError && error.code === 'OPERATION_TIMEOUT') return true;
        
        return false;
    }

    /**
     * Initializes the worker asynchronously with concurrency protection.
     */
    public async initializeAsync(): Promise<void> {
        if (this.isTerminated) return;
        
        // Return existing promise if initialization is in progress
        if (this.initPromise) {
            return this.initPromise;
        }

        // Return immediately if already ready
        if (this.worker && this.workerProxy) {
            return;
        }

        // Start initialization lock
        this.initPromise = (async () => {
            this.isInitializing = true;
            try {
                this.createWorker();
                
                if (this.validateOnInit && this.workerProxy) {
                    await this.validateWorker();
                }
            } catch (error) {
                // Clean up on failure
                this.cleanupResources();
                throw error;
            } finally {
                this.isInitializing = false;
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    /**
     * Synchronous initialization trigger (fire and forget).
     */
    public initialize(): void {
        this.initializeAsync().catch(err => {
            console.warn(`Version Control: Background initialization of ${this.workerName} failed`, err);
        });
    }

    /**
     * Creates the worker and proxy. Internal method.
     */
    protected createWorker(): void {
        // Double check inside lock
        if (this.worker) return;

        if (!this.workerString) {
            throw new WorkerManagerError(
                `${this.workerName} code missing`,
                'WORKER_CODE_MISSING'
            );
        }

        try {
            const blob = new Blob([this.workerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            
            this.worker = new Worker(this.workerUrl);
            
            // Add error listener for crash detection
            this.worker.onerror = (evt) => {
                console.error(`Version Control: ${this.workerName} error:`, evt);
                this.recordError();
            };

            this.workerProxy = wrap<TApi>(this.worker);
        } catch (error) {
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
     */
    protected async validateWorker(): Promise<void> {
        // Subclasses override this
    }

    /**
     * Ensures the worker is initialized and returns the proxy.
     * @deprecated Use execute() for safer operation handling.
     */
    public ensureWorker(): Remote<TApi> {
        if (this.isTerminated) {
            throw new WorkerManagerError(
                `${this.workerName} has been terminated`,
                'WORKER_UNAVAILABLE'
            );
        }
        
        if (!this.workerProxy) {
            // Synchronous creation attempt if not ready
            this.createWorker();
        }
        
        if (!this.workerProxy) {
            throw new WorkerManagerError(
                `${this.workerName} not available`,
                'WORKER_UNAVAILABLE'
            );
        }
        
        return this.workerProxy;
    }

    /**
     * Records a successful operation.
     */
    public recordOperation(duration: number): void {
        this.operationCount++;
        this.totalOperationTime += duration;
        this.lastSuccessTime = Date.now();

        // Reset error count if enough time has passed
        if (Date.now() - this.lastErrorTime > this.errorResetTime) {
            this.consecutiveErrors = 0;
        }
    }

    /**
     * Records an error.
     */
    public recordError(): void {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();
    }

    /**
     * Gets current health statistics.
     */
    public getHealthStats(): WorkerHealthStats {
        return {
            consecutiveErrors: this.consecutiveErrors,
            operationCount: this.operationCount,
            averageOperationTime: this.operationCount > 0 
                ? this.totalOperationTime / this.operationCount 
                : 0,
            isHealthy: this.consecutiveErrors < this.maxConsecutiveErrors,
            lastErrorTime: this.lastErrorTime,
            lastSuccessTime: this.lastSuccessTime
        };
    }

    /**
     * Checks if worker is healthy.
     */
    public isHealthy(): boolean {
        return this.consecutiveErrors < this.maxConsecutiveErrors;
    }

    /**
     * Terminates the worker and releases resources.
     * Idempotent and safe to call anytime.
     */
    public terminate(): void {
        if (this.isTerminated) return;
        this.isTerminated = true;
        this.cleanupResources();
    }

    /**
     * Restarts the worker.
     */
    public async restart(): Promise<void> {
        if (this.isTerminated) return;
        
        this.cleanupResources();
        this.consecutiveErrors = 0;
        
        await this.initializeAsync();
    }

    /**
     * Cleans up resources safely.
     */
    protected cleanupResources(): void {
        // 1. Release Proxy
        if (this.workerProxy) {
            try {
                const releaseProxySymbol = releaseProxy as unknown as string;
                const releaseFn = (this.workerProxy as unknown as Record<string, () => void | undefined>)[releaseProxySymbol];
                if (typeof releaseFn === 'function') {
                    releaseFn();
                }
            } catch (e) {
                // Ignore errors during cleanup
            }
            this.workerProxy = null;
        }

        // 2. Terminate Worker
        if (this.worker) {
            try {
                this.worker.terminate();
            } catch (e) {
                // Ignore
            }
            this.worker = null;
        }

        // 3. Revoke URL
        if (this.workerUrl) {
            try {
                URL.revokeObjectURL(this.workerUrl);
            } catch (e) {
                // Ignore
            }
            this.workerUrl = null;
        }
    }

    /**
     * Status getters
     */
    public isTerminatedState(): boolean { return this.isTerminated; }
    public isInitialized(): boolean { return this.worker !== null; }
    public isActive(): boolean { return this.worker !== null && !this.isTerminated; }

    public getStatus() {
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
 * Utility to prepare transferables.
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
