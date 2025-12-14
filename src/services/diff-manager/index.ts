/**
 * DiffManager Module
 *
 * This module provides diff computation functionality using web workers with LRU caching.
 * It's designed to handle large content efficiently with retry logic and health monitoring.
 *
 * @module services/diff-manager
 */

// ============================================================================
// PUBLIC API
// ============================================================================

export { DiffManager } from './DiffManager';
export { DiffManagerError } from './types';
export type { WorkerStatus, CacheStats, WorkerHealthStats } from './types';

// ============================================================================
// INTERNAL UTILITIES (for testing or advanced use)
// ============================================================================

export { DiffCache, CacheKeyGenerator } from './cache';
export { WorkerHealthMonitor, WorkerProxy } from './workers';
export { DiffComputer, DiffValidator } from './operations';
export * from './config';
