/**
 * @fileoverview Markdown stripping utilities
 *
 * Provides functions to strip markdown formatting from text while
 * preserving content. Supports both synchronous and asynchronous processing.
 */

import { validateTextInput } from '@/utils/text-stats/validation';
import { applyPatterns, applyPatternsAsync, memoizedNormalize, normalizeWhitespace, yieldToMain } from '@/utils/text-stats/text-processor';
import { MARKDOWN_PATTERNS } from '@/utils/text-stats/config';

/**
 * PUBLIC API
 * ============================================================================
 */

export const stripMarkdown = (text: string): string => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return '';
  }

  const stripped = applyPatterns(validated, MARKDOWN_PATTERNS);
  const normalized = memoizedNormalize(stripped);

  return normalized;
};

export const stripMarkdownAsync = async (text: string): Promise<string> => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return '';
  }

  const stripped = await applyPatternsAsync(validated, MARKDOWN_PATTERNS);
  await yieldToMain();
  const normalized = normalizeWhitespace(stripped);

  return normalized;
};
