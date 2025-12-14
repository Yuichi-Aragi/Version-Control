/**
 * Type definitions for DiffManager module
 */

export class DiffManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'DiffManagerError';
    }
}

export interface WorkerHealthStats {
    consecutiveErrors: number;
    operationCount: number;
    averageOperationTime: number;
    isHealthy: boolean;
}

export interface WorkerStatus {
    isInitialized: boolean;
    isActive: boolean;
    isHealthy: boolean;
    healthStats: {
        consecutiveErrors: number;
        operationCount: number;
        averageOperationTime: number;
    };
}

export interface CacheStats {
    size: number;
    capacity: number;
    utilization: number;
}
