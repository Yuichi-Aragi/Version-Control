import type { EditWorkerApi } from '@/types';
import { WorkerManager, WorkerManagerError } from '@/workers';
import type { EditHistoryErrorCode, OperationMetadata } from '@/types';
import type { Remote } from 'comlink';

// Injected by esbuild define
declare const editHistoryWorkerString: string;

/**
 * @deprecated Use EditWorkerManager instead
 */
export type WorkerClient = EditWorkerManager;

/**
 * Specialized worker manager for the Edit History Worker.
 */
export class EditWorkerManager extends WorkerManager<EditWorkerApi> {
    constructor() {
        super({
            workerString: typeof editHistoryWorkerString !== 'undefined' ? editHistoryWorkerString : '',
            workerName: 'Edit History Worker',
            validateOnInit: false,
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    /**
     * Override initialize to wrap errors in EditHistoryWorkerError
     */
    public override async initializeAsync(): Promise<void> {
        try {
            await super.initializeAsync();
        } catch (error) {
            throw this.wrapError(error);
        }
    }

    /**
     * Override execute to wrap errors in EditHistoryWorkerError
     */
    public override async execute<T>(
        operation: (api: Remote<EditWorkerApi>) => Promise<T> | T,
        options: { timeout?: number; retry?: boolean; retryAttempts?: number } = {}
    ): Promise<T> {
        try {
            return await super.execute(operation, options);
        } catch (error) {
            throw this.wrapError(error);
        }
    }

    /**
     * Helper to wrap generic worker errors into domain-specific errors
     */
    private wrapError(error: unknown): Error {
        if (error instanceof EditHistoryWorkerError) return error;
        
        const message = error instanceof Error ? error.message : String(error);
        let code: EditHistoryErrorCode = 'WORKER_UNAVAILABLE';
        
        if (error instanceof WorkerManagerError) {
            if (error.code === 'OPERATION_TIMEOUT') code = 'OPERATION_TIMEOUT';
            else if (error.code === 'INIT_FAILED') code = 'WORKER_UNAVAILABLE';
        }

        return new EditHistoryWorkerError(message, code, undefined, error);
    }

    /**
     * Checks if the worker is available (initialized and not terminated).
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
