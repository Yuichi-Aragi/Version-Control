/**
 * Storage Layer Module
 *
 * This module provides the storage abstraction layer for the version control plugin.
 * It exports concrete implementations and re-exports interface definitions for
 * loose coupling via Inversify dependency injection.
 *
 * @module core/storage
 *
 * ## Architecture
 *
 * The storage layer follows the Repository Pattern with these components:
 *
 * - **PathService**: Centralized path generation for database files and folders
 * - **StorageService**: Low-level filesystem operations via Obsidian's adapter
 * - **CentralManifestRepository**: Manages the global manifest tracking all notes
 * - **NoteManifestRepository**: Manages per-note manifests with version metadata
 * - **VersionContentRepository**: Handles version file content I/O
 * - **TimelineDatabase**: Client interface for timeline worker operations
 *
 * ## Usage
 *
 * ```typescript
 * import { PathService, type IPathService } from '@/core/storage';
 *
 * // Bind to Inversify container
 * container.bind<IPathService>(TYPES.PathService).to(PathService);
 * ```
 */

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

export { PathService } from './path-service';
export { StorageService } from './storage-service';
export { CentralManifestRepository } from './central-manifest-repository';
export { NoteManifestRepository } from './note-manifest-repository';
export { VersionContentRepository } from './version-content-repository';
export { TimelineDatabase } from './timeline-database';

// ============================================================================
// INTERFACE RE-EXPORTS
// ============================================================================

export type {
    IPathService,
    IStorageService,
    ICentralManifestRepository,
    INoteManifestRepository,
    IVersionContentRepository,
    ITimelineDatabase,
} from '@/types/interfaces';
