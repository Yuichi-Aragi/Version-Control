/**
 * Worker Manager Types
 * 
 * Common types for centralized worker management across the plugin.
 * These types support the WorkerManager class and related utilities.
 */

import type { Remote } from 'comlink';

/**
 * Base type for worker APIs exposed via Comlink.
 * This is a marker type used for documentation and type safety.
 * Actual worker API interfaces should extend this.
 */
export type WorkerApi = Record<string, unknown>;

/**
 * Health statistics for a worker.
 */
export interface WorkerHealthStats {
    /** Number of consecutive errors since last successful operation */
    consecutiveErrors: number;
    /** Total number of operations performed */
    operationCount: number;
    /** Average time per operation in milliseconds */
    averageOperationTime: number;
    /** Whether the worker is considered healthy */
    isHealthy: boolean;
    /** Timestamp of the last error */
    lastErrorTime: number;
    /** Timestamp of the last successful operation */
    lastSuccessTime: number;
}

/**
 * Worker status for monitoring and debugging.
 */
export interface WorkerStatus {
    /** Whether the worker has been initialized */
    isInitialized: boolean;
    /** Whether the worker is active (initialized and not terminated) */
    isActive: boolean;
    /** Whether the worker is currently healthy */
    isHealthy: boolean;
    /** Current health statistics */
    healthStats: WorkerHealthStats;
}

/**
 * Error codes for worker operations.
 */
export type WorkerErrorCode =
    | 'INVALID_STATE'
    | 'WORKER_UNAVAILABLE'
    | 'INIT_FAILED'
    | 'WORKER_CREATION_FAILED'
    | 'VALIDATION_FAILED'
    | 'OPERATION_TIMEOUT'
    | 'TERMINATION_FAILED'
    | 'INVALID_INPUT'
    | 'CONTENT_TOO_LARGE'
    | 'DECODING_FAILED'
    | 'SERIALIZATION_FAILED'
    | 'DIFF_FAILED'
    | 'DB_ERROR'
    | 'DB_UPDATE_FAILED'
    | 'DB_DELETE_FAILED'
    | 'DB_CLEAR_FAILED'
    | 'DB_GLOBAL_CLEAR_FAILED'
    | 'LOCK_TIMEOUT'
    | 'COMPRESSION_FAILED'
    | 'WORKER_CRASHED'
    | 'WORKER_DISCONNECTED';

/**
 * Common worker initialization options.
 */
export interface WorkerInitOptions {
    /** Whether to validate worker after initialization */
    validateOnInit?: boolean;
    /** Maximum consecutive errors before marking unhealthy */
    maxConsecutiveErrors?: number;
    /** Time window in ms to reset error count */
    errorResetTime?: number;
}

/**
 * Options for executing a worker operation.
 */
export interface WorkerExecutionOptions {
    /** Timeout in milliseconds for the operation. Default: 30000ms */
    timeout?: number;
    /** Whether to automatically retry on failure. Default: true */
    retry?: boolean;
    /** Number of retry attempts. Default: 1 */
    retryAttempts?: number;
    /** Whether to force a worker restart before execution. Default: false */
    forceRestart?: boolean;
}

/**
 * Base configuration for worker managers.
 */
export interface WorkerConfig {
    /** The worker code string injected during build */
    workerString: string;
    /** Human-readable name for logging and errors */
    workerName: string;
    /** Initialization options */
    options?: WorkerInitOptions;
}

/**
 * Result of a worker operation.
 */
export interface WorkerResult<T = void> {
    /** Whether the operation was successful */
    success: boolean;
    /** Result data if successful */
    data?: T;
    /** Error if operation failed */
    error?: Error;
}

/**
 * Type for the releaseProxy method used by Comlink.
 */
export type ReleaseProxy = (() => void) & {
    /** Symbol property used by Comlink */
    readonly [releaseProxy]: unique symbol;
};

/**
 * Symbol used by Comlink for proxy release.
 */
declare const releaseProxy: unique symbol;

/**
 * Type for Comlink Remote proxy objects.
 */
export type WorkerProxy<TApi> = Remote<TApi>;
