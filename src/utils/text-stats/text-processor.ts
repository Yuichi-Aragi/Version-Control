/**
 * @fileoverview Core text processing and async utilities
 *
 * Provides text processing functions including pattern application,
 * whitespace normalization, and non-blocking async utilities.
 */

import { memoize } from 'es-toolkit';
import { CONFIG } from '@/utils/text-stats/config';
import { RegexCache } from '@/utils/text-stats/regex-cache';
import { ResourceError } from '@/utils/text-stats/types';
import type { MarkdownPattern } from '@/utils/text-stats/types';

/**
 * YIELD UTILITIES (Non-blocking)
 * ============================================================================
 */

export const yieldToMain = (): Promise<void> => {
  if (typeof globalThis !== 'undefined' && 'scheduler' in globalThis) {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof scheduler?.yield === 'function') {
      return scheduler.yield();
    }
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

export const shouldYield = (() => {
  let lastYield = 0;
  return (): boolean => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastYield >= CONFIG.YIELD_INTERVAL) {
      lastYield = now;
      return true;
    }
    return false;
  };
})();

/**
 * CORE TEXT PROCESSING FUNCTIONS
 * ============================================================================
 */

export const applyPatterns = (
  text: string,
  patterns: readonly MarkdownPattern[]
): string => {
  let result = text;

  const sorted = [...patterns].sort((a, b) => a.priority - b.priority);

  for (const { pattern, flags, replacement } of sorted) {
    const regex = RegexCache.get(pattern, flags);

    if (typeof replacement === 'string') {
      result = result.replace(regex, replacement);
    } else {
      result = result.replace(regex, replacement);
    }

    if (result.length > CONFIG.MAX_OUTPUT_SIZE) {
      throw new ResourceError('outputText', CONFIG.MAX_OUTPUT_SIZE, result.length);
    }
  }

  return result;
};

export const applyPatternsAsync = async (
  text: string,
  patterns: readonly MarkdownPattern[]
): Promise<string> => {
  let result = text;
  const sorted = [...patterns].sort((a, b) => a.priority - b.priority);

  for (const { pattern, flags, replacement } of sorted) {
    if (shouldYield()) {
      await yieldToMain();
    }

    const regex = RegexCache.get(pattern, flags);

    if (typeof replacement === 'string') {
      result = result.replace(regex, replacement);
    } else {
      result = result.replace(regex, replacement);
    }

    if (result.length > CONFIG.MAX_OUTPUT_SIZE) {
      throw new ResourceError('outputText', CONFIG.MAX_OUTPUT_SIZE, result.length);
    }
  }

  return result;
};

export const normalizeWhitespace = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^ +| +$/gm, '')
    .trim();
};

/**
 * MEMOIZED HELPERS
 * ============================================================================
 */

export const memoizedNormalize = memoize(normalizeWhitespace);
