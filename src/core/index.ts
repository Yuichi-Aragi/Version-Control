/**
 * Core Module
 *
 * This module provides the core business logic layer for the version control plugin.
 * It exports manager classes that orchestrate storage operations, version handling,
 * timeline generation, and edit history management.
 *
 * @module core
 *
 * ## Architecture
 *
 * The core layer consists of:
 *
 * ### Managers
 * - **ManifestManager**: Orchestrates manifest loading/saving operations
 * - **NoteManager**: Handles note lifecycle events (create, modify, rename, delete)
 * - **VersionManager**: Manages version CRUD operations and restoration
 * - **TimelineManager**: Generates and caches timeline events for visualization
 * - **EditHistoryManager**: Manages IndexedDB-based edit history operations
 * - **CompressionManager**: Provides GZIP compression/decompression via worker
 *
 * ### Events
 * - **PluginEvents**: Central event bus for cross-component communication
 *
 * ## Sub-modules
 *
 * - **storage**: Repository pattern implementations for data persistence
 * - **tasks**: Background task management (watch mode, cleanup)
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   VersionManager,
 *   type IVersionManager,
 *   type VersionControlEvents
 * } from '@/core';
 *
 * // Inject via Inversify
 * constructor(@inject(TYPES.VersionManager) private versionManager: IVersionManager) {}
 * ```
 */

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

export { CompressionManager } from './compression-manager';
export { EditHistoryManager } from './edit-history-manager';
export { ManifestManager } from './manifest-manager';
export { NoteManager } from './note-manager';
export { PluginEvents } from './plugin-events';
export { TimelineManager } from './timeline-manager';
export { VersionManager } from './version-manager';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type { VersionControlEvents } from './plugin-events';

// ============================================================================
// INTERFACE RE-EXPORTS
// ============================================================================

export type {
    IManifestManager,
    INoteManager,
    IVersionManager,
    ITimelineManager,
    IEditHistoryManager,
    ICompressionManager,
    IPluginEvents,
} from '@/types/interfaces';

// ============================================================================
// SUB-MODULE RE-EXPORTS
// ============================================================================

export * from './storage';
export * from './tasks';
