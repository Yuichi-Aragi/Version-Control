/**
 * @fileoverview Production-ready text processing module
 *
 * Provides secure, validated, and performant text analysis utilities
 * with comprehensive markdown stripping and statistics calculation.
 *
 * Key features:
 * - Schema-based validation with Valibot
 * - Immutable outputs with Immer
 * - Optimized utilities from es-toolkit
 * - Non-blocking async processing for large inputs
 * - Unicode-aware word and character counting
 * - Comprehensive security checks
 * - Fully idempotent operations
 */

import { freeze } from 'immer';
import { RegexCache } from '@/utils/text-stats/regex-cache';
import { validateTextInput } from '@/utils/text-stats/validation';
import { CONFIG } from '@/utils/text-stats/config';

/**
 * TYPE EXPORTS
 * ============================================================================
 */

export type {
  TextStats,
  TextInputOptions,
  MarkdownPattern,
  CacheEntry,
} from '@/utils/text-stats/types';

/**
 * ERROR CLASS EXPORTS
 * ============================================================================
 */

export {
  SecurityError,
  ValidationError,
  ResourceError,
} from '@/utils/text-stats/types';

/**
 * CONFIGURATION EXPORTS
 * ============================================================================
 */

export {
  CONFIG,
  MARKDOWN_PATTERNS,
} from '@/utils/text-stats/config';

/**
 * MARKDOWN PROCESSING EXPORTS
 * ============================================================================
 */

export {
  stripMarkdown,
  stripMarkdownAsync,
} from '@/utils/text-stats/markdown-processor';

/**
 * COUNTING EXPORTS
 * ============================================================================
 */

export {
  countWords,
  countChars,
  countCharsCodePoints,
  countLines,
} from '@/utils/text-stats/counters';

/**
 * STATISTICS EXPORTS
 * ============================================================================
 */

export {
  calculateTextStats,
  calculateTextStatsAsync,
  processText,
  processTextAsync,
} from '@/utils/text-stats/stats-calculator';

/**
 * UTILITY FUNCTIONS
 * ============================================================================
 */

export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const validateAndSanitizeString = (
  value: unknown,
  paramName: string,
  options: import('@/utils/text-stats/types').TextInputOptions = {}
): string => {
  return validateTextInput(value, paramName, options);
};

export const clearCache = (): void => {
  RegexCache.clear();
};

export const getCacheStats = (): { size: number; maxSize: number } => {
  return freeze({
    size: RegexCache.size(),
    maxSize: CONFIG.MAX_CACHE_SIZE,
  });
};
