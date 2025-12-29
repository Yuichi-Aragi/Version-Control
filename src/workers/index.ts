/**
 * Workers Module
 * 
 * This module provides web worker implementations for CPU-intensive operations
 * and a centralized WorkerManager for consistent worker lifecycle management.
 */

// ============================================================================
// WORKER MANAGER
// ============================================================================

export { WorkerManager, WorkerManagerError } from './worker-manager';

// ============================================================================
// WORKER TYPES
// ============================================================================

// Explicitly export types to avoid collisions
export type {
    WorkerApi,
    WorkerHealthStats,
    WorkerStatus,
    WorkerErrorCode,
    WorkerInitOptions,
    WorkerConfig,
    WorkerResult,
    WorkerProxy
} from './types';

// ============================================================================
// WORKER EXPORTS
// ============================================================================

export * from './compression.worker';
export * from './diff.worker';
export * from './edit-history';
export * from './timeline';

// ============================================================================
// TYPE RE-EXPORTS
// ============================================================================

export type {
    DiffWorkerApi,
    CompressionWorkerApi,
    TimelineWorkerApi,
    EditWorkerApi,
} from '@/types';
