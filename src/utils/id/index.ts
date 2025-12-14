/**
 * ID generation and sanitization utilities for version control system
 *
 * @module id-utils
 */

// Re-export all public APIs
export { generateNoteId, generateUniqueId } from '@/utils/id/note-id-generator';
export { generateVersionId } from '@/utils/id/version-id-generator';
export { sanitizeId, transformFilePathExtensions, extractUuidFromId, extractTimestampFromId } from '@/utils/id/sanitizers';
