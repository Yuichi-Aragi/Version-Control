/**
 * @fileoverview Configuration constants and patterns
 *
 * Defines all configuration constants and markdown patterns used throughout
 * the text processing system.
 */

import { freeze } from 'immer';
import type { MarkdownPattern } from '@/utils/text-stats/types';

/**
 * CONFIGURATION CONSTANTS
 * ============================================================================
 */

export const CONFIG = Object.freeze({
  MAX_INPUT_BYTES: 10 * 1024 * 1024,
  MAX_INPUT_LENGTH: 10_000_000,
  MAX_OUTPUT_SIZE: 20 * 1024 * 1024,
  MAX_PATTERN_LENGTH: 1000,
  MAX_CACHE_SIZE: 100,
  CHUNK_SIZE: 32768,
  ASYNC_THRESHOLD: 50000,
  YIELD_INTERVAL: 16,
} as const);

/**
 * MARKDOWN PATTERNS
 * ============================================================================
 */

export const MARKDOWN_PATTERNS: readonly MarkdownPattern[] = freeze([
  { pattern: '```[\\s\\S]*?```', flags: 'g', replacement: '', priority: 1 },
  { pattern: '`[^`]+`', flags: 'g', replacement: (_m, ...args) => {
    const content = args[0];
    return typeof content === 'string' ? content : '';
  }, priority: 2 },
  { pattern: '<[^>]*>', flags: 'g', replacement: '', priority: 3 },
  { pattern: '!\\[([^\\]]*)\\]\\([^)]*\\)', flags: 'g', replacement: '$1', priority: 4 },
  { pattern: '\\[([^\\]]*)\\]\\([^)]*\\)', flags: 'g', replacement: '$1', priority: 5 },
  { pattern: '\\*\\*\\*([^*]+)\\*\\*\\*', flags: 'g', replacement: '$1', priority: 6 },
  { pattern: '___([^_]+)___', flags: 'g', replacement: '$1', priority: 7 },
  { pattern: '\\*\\*([^*]+)\\*\\*', flags: 'g', replacement: '$1', priority: 8 },
  { pattern: '__([^_]+)__', flags: 'g', replacement: '$1', priority: 9 },
  { pattern: '\\*([^*]+)\\*', flags: 'g', replacement: '$1', priority: 10 },
  { pattern: '_([^_]+)_', flags: 'g', replacement: '$1', priority: 11 },
  { pattern: '~~([^~]+)~~', flags: 'g', replacement: '$1', priority: 12 },
  { pattern: '==([^=]+)==', flags: 'g', replacement: '$1', priority: 13 },
  { pattern: '^#{1,6}\\s+', flags: 'gm', replacement: '', priority: 14 },
  { pattern: '^>\\s*', flags: 'gm', replacement: '', priority: 15 },
  { pattern: '^\\s*[-*+]\\s+', flags: 'gm', replacement: '', priority: 16 },
  { pattern: '^\\s*\\d+\\.\\s+', flags: 'gm', replacement: '', priority: 17 },
  { pattern: '^\\s*[-*_]{3,}\\s*$', flags: 'gm', replacement: '', priority: 18 },
  { pattern: '\\[\\^[^\\]]+\\]', flags: 'g', replacement: '', priority: 19 },
]);
