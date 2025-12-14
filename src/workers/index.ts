/**
 * Web Workers Module
 *
 * This module provides web worker implementations for CPU-intensive operations.
 * Workers run in separate threads to avoid blocking the main UI thread.
 *
 * @module workers
 *
 * ## Workers
 *
 * - **compression.worker**: GZIP compression/decompression operations
 * - **diff.worker**: Diff computation between text versions (line, word, character)
 * - **edit-history**: IndexedDB operations for edit history management (modular)
 * - **timeline**: Timeline event generation and IndexedDB storage (modular)
 *
 * ## Architecture
 *
 * Workers communicate with the main thread via Comlink, providing
 * typed async APIs. Data transfer uses ArrayBuffer with transfer
 * ownership for zero-copy performance.
 *
 * ## Usage
 *
 * Workers are typically instantiated by their respective manager classes:
 *
 * ```typescript
 * import { CompressionManager } from '@/core';
 * import { DiffManager } from '@/services';
 *
 * // Managers handle worker lifecycle internally
 * const compressionManager = container.get<ICompressionManager>(TYPES.CompressionManager);
 * const compressed = await compressionManager.compress(content);
 * ```
 *
 * ## Worker APIs
 *
 * See the type definitions in `@/types`:
 * - `DiffWorkerApi`
 * - `CompressionWorkerApi`
 * - `TimelineWorkerApi`
 * - `EditWorkerApi`
 */

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
