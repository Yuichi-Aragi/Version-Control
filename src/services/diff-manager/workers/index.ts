/**
 * Worker management utilities for DiffManager
 * 
 * This module provides worker lifecycle management with health monitoring
 * and validation for the diff worker.
 * 
 * @module diff-manager/workers
 */

// ============================================================================
// WORKER MANAGER (NEW)
// ============================================================================

export { DiffWorkerManager, DiffWorkerManagerError } from './worker-manager';

// ============================================================================
// HEALTH MONITORING
// ============================================================================

/**
 * Worker health monitoring utilities.
 * Used internally by WorkerManager but exported for compatibility.
 */
export { WorkerHealthMonitor } from './worker-pool';

// ============================================================================
// DEPRECATED (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use DiffWorkerManager instead
 */
export { WorkerProxy } from './worker-proxy';
