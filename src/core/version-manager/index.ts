/**
 * Version Manager Module
 *
 * This module provides version control operations including saving, restoring,
 * deleting, and managing versions. It follows a modular architecture with
 * separation of concerns between operations, helpers, and validation.
 *
 * @module core/version-manager
 */

// ============================================================================
// MAIN CLASS EXPORT
// ============================================================================

export { VersionManager } from '@/core/version-manager/VersionManager';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  SaveVersionOptions,
  SaveVersionResult,
  UpdateVersionDetails,
  CreateDeviationParams,
  CreateDeviationFromContentParams,
  RestoreVersionParams,
  DeleteVersionParams,
  BranchState,
  VersionMetadata,
} from '@/core/version-manager/types';

// ============================================================================
// OPERATION EXPORTS (for advanced usage)
// ============================================================================

export {
  SaveOperation,
  RestoreOperation,
  DeleteOperation,
  UpdateOperation,
} from '@/core/version-manager/operations';

// ============================================================================
// HELPER EXPORTS (for advanced usage)
// ============================================================================

export {
  MetadataBuilder,
  DuplicateDetector,
  StatsPreparer,
} from '@/core/version-manager/helpers';

// ============================================================================
// VALIDATION EXPORTS (for advanced usage)
// ============================================================================

export { VersionValidator } from '@/core/version-manager/validation';
