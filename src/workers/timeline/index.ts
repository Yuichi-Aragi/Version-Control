/// <reference lib="webworker" />

import { expose } from 'comlink';
import { timelineApi } from '@/workers/timeline/api';

/**
 * High-Performance Timeline Worker
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Idempotency: Operations can be retried safely without side effects
 * 2. Atomicity: Database mutations are transactional
 * 3. Isolation: Web Locks serialize operations on specific entities
 * 4. Integrity: Strict input validation and encoding checks
 * 5. Zero-Copy: Minimal memory transfers using ArrayBuffer transfers
 * 6. Compression: Timeline diffs are compressed using Deflate (fflate)
 *
 * PERFORMANCE CHARACTERISTICS:
 * - O(n) diff computation with early bailout optimization
 * - Constant-time lookups via compound indices
 * - Memory-optimized string processing
 * - Batch operations with minimal locking
 * - Compressed storage to minimize IndexedDB footprint
 *
 * MODULAR STRUCTURE:
 * - /database: Dexie database setup and CRUD operations
 * - /services: Business logic for timeline building and processing
 * - /utils: Validation and data transformation utilities
 * - /api: Main API implementation
 * - /types: TypeScript interfaces and error definitions
 * - /config: Constants and configuration
 */

// Expose the API to the main thread via Comlink
expose(timelineApi);

// Re-export types for external consumers
export type { WorkerError, WorkerErrorCode } from '@/workers/timeline/types';
