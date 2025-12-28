import type { EditWorkerApi } from '@/types';
import { WorkerManager, WorkerManagerError, type WorkerHealthStats } from '@/workers';
import type { OperationMetadata, EditHistoryErrorCode } from '@/types';
import type { Remote } from 'comlink';

// Injected by esbuild define
declare const editHistoryWorkerString: string;

/**
 * @deprecated Use EditWorkerManager instead
 */
export type WorkerClient = EditWorkerManager;

/**
 * Specialized worker manager for the Edit History Worker.
 * Provides lazy initialization with ensureWorker() pattern.
 */
export class EditWorkerManager extends WorkerManager<EditWorkerApi> {
    constructor() {
        super({
            workerString: typeof editHistoryWorkerString !== 'undefined' ? editHistoryWorkerString : '',
            workerName: 'Edit History Worker',
            validateOnInit: false, // Edit worker validation happens on first operation
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    /**
     * Ensures the worker is initialized and ready for use.
     * Provides lazy initialization with proper error handling.
     * @returns The worker proxy for making API calls
     * @throws EditHistoryError if worker is terminated or unavailable
     */
    public override ensureWorker(): Remote<EditWorkerApi> {
        try {
            return super.ensureWorker();
        } catch (error) {
            if (error instanceof WorkerManagerError) {
                throw new EditHistoryWorkerError(
                    error.message,
                    'WORKER_UNAVAILABLE',
                    undefined,
                    error
                );
            }
            throw error;
        }
    }

    /**
     * Initializes the worker synchronously.
     * @throws EditHistoryError if worker code is missing or initialization fails
     */
    public override initialize(): void {
        try {
            super.initialize();
        } catch (error) {
            if (error instanceof WorkerManagerError) {
                throw new EditHistoryWorkerError(
                    error.message,
                    'WORKER_UNAVAILABLE',
                    undefined,
                    error
                );
            }
            throw error;
        }
    }

    /**
     * Checks if the worker is available (initialized and not terminated).
     * @returns true if worker is available, false otherwise
     */
    public isAvailable(): boolean {
        return this.isActive();
    }
}

/**
 * Error class for EditHistoryWorker operations.
 */
export class EditHistoryWorkerError extends Error {
    readonly timestamp: number;
    readonly operationId?: string;

    constructor(
        message: string,
        readonly code: EditHistoryErrorCode,
        readonly metadata: Partial<OperationMetadata> = {},
        override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'EditHistoryWorkerError';
        this.timestamp = Date.now();
        if (metadata.id !== undefined) {
            this.operationId = metadata.id;
        }
        Object.freeze(this);
    }

    static isRetryable(error: unknown): boolean {
        if (!(error instanceof EditHistoryWorkerError)) return false;
        
        switch (error.code) {
            case 'OPERATION_TIMEOUT':
            case 'DISK_WRITE_FAILED':
            case 'DISK_READ_FAILED':
                return true;
            default:
                return false;
        }
    }
}

/**
 * Health statistics for the edit history worker.
 */
export interface EditWorkerHealthStats extends WorkerHealthStats {
    pendingOperations: number;
}

/**
 * Worker health monitoring for edit history operations.
 */
export class EditWorkerHealthMonitor {
    private consecutiveErrors = 0;
    private lastErrorTime = 0;
    private operationCount = 0;
    private totalOperationTime = 0;
    private pendingOperations = 0;
    private readonly maxConsecutiveErrors = 3;
    private readonly errorResetTime = 60000; // 1 minute

    /**
     * Records a pending operation start.
     */
    recordPending(): void {
        this.pendingOperations++;
    }

    /**
     * Records operation completion.
     */
    recordComplete(): void {
        this.pendingOperations = Math.max(0, this.pendingOperations - 1);
    }

    /**
     * Records an operation with duration.
     */
    recordOperation(duration: number): void {
        this.operationCount++;
        this.totalOperationTime += duration;
        this.recordComplete();

        if (Date.now() - this.lastErrorTime > this.errorResetTime) {
            this.consecutiveErrors = 0;
        }
    }

    /**
     * Records an error.
     */
    recordError(): void {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();
        this.recordComplete();
    }

    /**
     * Gets the average operation time.
     */
    getAverageOperationTime(): number {
        return this.operationCount > 0 ? this.totalOperationTime / this.operationCount : 0;
    }

    /**
     * Checks if the worker is healthy.
     */
    isHealthy(): boolean {
        return this.consecutiveErrors < this.maxConsecutiveErrors;
    }

    /**
     * Gets the current health statistics.
     */
    getStats(): EditWorkerHealthStats {
        return {
            consecutiveErrors: this.consecutiveErrors,
            operationCount: this.operationCount,
            averageOperationTime: this.getAverageOperationTime(),
            isHealthy: this.isHealthy(),
            pendingOperations: this.pendingOperations,
        };
    }
}
