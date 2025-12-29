import { type Remote } from 'comlink';
import type { DiffWorkerApi } from '@/types';
import { WorkerManager, WorkerManagerError } from '@/workers';

// Injected by esbuild define
declare const diffWorkerString: string;

/**
 * Error codes for DiffWorkerManager operations.
 */
export type DiffWorkerManagerErrorCode =
    | 'WORKER_CODE_MISSING'
    | 'WORKER_INIT_FAILED'
    | 'WORKER_PROXY_MISSING'
    | 'WORKER_TEST_FAILED'
    | 'VALIDATION_FAILED';

/**
 * Extended worker manager for the Diff Worker with built-in validation.
 */
export class DiffWorkerManager extends WorkerManager<DiffWorkerApi> {
    private readonly decoder = new TextDecoder('utf-8');

    constructor() {
        super({
            workerString: typeof diffWorkerString !== 'undefined' ? diffWorkerString : '',
            workerName: 'Diff Worker',
            validateOnInit: true,
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    /**
     * Validates that the worker is functioning correctly.
     * Runs a simple diff computation to verify the worker is operational.
     * @throws Error if validation fails
     */
    protected override async validateWorker(): Promise<void> {
        const proxy = this.ensureWorker();
        
        try {
            const testContent1 = 'test line 1\ntest line 2';
            const testContent2 = 'test line 1\nmodified line 2';
            
            const resultBuffer = await proxy.computeDiff('lines', testContent1, testContent2);
            const json = this.decoder.decode(resultBuffer);
            const changes = JSON.parse(json);
            
            if (!Array.isArray(changes)) {
                throw new WorkerManagerError(
                    'Worker validation failed: returned invalid data type',
                    'VALIDATION_FAILED'
                );
            }
        } catch (error) {
            if (error instanceof WorkerManagerError) {
                throw error;
            }
            throw new WorkerManagerError(
                `Worker validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'VALIDATION_FAILED',
                { originalError: error }
            );
        }
    }

    /**
     * Gets a proxy for the diff worker API.
     * @returns The worker proxy
     * @throws WorkerManagerError if worker is terminated or unavailable
     */
    public getProxy(): Remote<DiffWorkerApi> {
        return this.ensureWorker();
    }
}

/**
 * Error class for DiffWorkerManager operations.
 */
export class DiffWorkerManagerError extends WorkerManagerError {
    constructor(
        message: string,
        code: DiffWorkerManagerErrorCode,
        context?: Record<string, unknown>
    ) {
        super(message, code, context);
        this.name = 'DiffWorkerManagerError';
    }
}
