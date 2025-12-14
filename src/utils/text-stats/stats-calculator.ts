/**
 * @fileoverview Text statistics calculation and aggregation
 *
 * Provides comprehensive text statistics including word counts, character counts,
 * line counts, and processing metrics. Supports both synchronous and asynchronous
 * processing for large inputs.
 */

import { freeze } from 'immer';
import { validateTextInput } from '@/utils/text-stats/validation';
import { stripMarkdown, stripMarkdownAsync } from '@/utils/text-stats/markdown-processor';
import { countWordsImpl, countGraphemesImpl, countCodePointsImpl, countLinesImpl } from '@/utils/text-stats/counters';
import { yieldToMain } from '@/utils/text-stats/text-processor';
import { CONFIG } from '@/utils/text-stats/config';
import type { TextStats } from '@/utils/text-stats/types';

/**
 * TEXT STATISTICS CALCULATION
 * ============================================================================
 */

export const calculateTextStats = (content: string): TextStats => {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const validated = validateTextInput(content, 'content', { allowEmpty: true });
  const stripped = stripMarkdown(validated);

  const wordCountVal = countWordsImpl(stripped);
  const wordCountWithMarkdownVal = countWordsImpl(validated);
  const charCountVal = countGraphemesImpl(stripped);
  const charCountWithMarkdownVal = countGraphemesImpl(validated);
  const lineCountWithoutMarkdownVal = countLinesImpl(stripped);

  const stats: TextStats = freeze({
    wordCount: wordCountVal,
    wordCountWithMarkdown: wordCountWithMarkdownVal,
    charCount: charCountVal,
    charCountWithMarkdown: charCountWithMarkdownVal,
    codePointCount: countCodePointsImpl(stripped),
    codePointCountWithMarkdown: countCodePointsImpl(validated),
    lineCount: countLinesImpl(validated),
    lineCountWithoutMarkdown: lineCountWithoutMarkdownVal,
    processingTimeMs: 0,
    // Aliases for backward compatibility
    wordCountWithMd: wordCountWithMarkdownVal,
    charCountWithMd: charCountWithMarkdownVal,
    lineCountWithoutMd: lineCountWithoutMarkdownVal,
  });

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const processingTimeMs = Math.round((endTime - startTime) * 1000) / 1000;

  return freeze({
    ...stats,
    processingTimeMs,
  });
};

export const calculateTextStatsAsync = async (content: string): Promise<TextStats> => {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const validated = validateTextInput(content, 'content', { allowEmpty: true });

  await yieldToMain();

  const stripped = await stripMarkdownAsync(validated);

  await yieldToMain();

  const wordCount = countWordsImpl(stripped);
  const wordCountWithMarkdown = countWordsImpl(validated);

  await yieldToMain();

  const charCount = countGraphemesImpl(stripped);
  const charCountWithMarkdown = countGraphemesImpl(validated);
  const codePointCount = countCodePointsImpl(stripped);
  const codePointCountWithMarkdown = countCodePointsImpl(validated);

  await yieldToMain();

  const lineCount = countLinesImpl(validated);
  const lineCountWithoutMarkdown = countLinesImpl(stripped);

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const processingTimeMs = Math.round((endTime - startTime) * 1000) / 1000;

  return freeze({
    wordCount,
    wordCountWithMarkdown,
    charCount,
    charCountWithMarkdown,
    codePointCount,
    codePointCountWithMarkdown,
    lineCount,
    lineCountWithoutMarkdown,
    processingTimeMs,
    // Aliases for backward compatibility
    wordCountWithMd: wordCountWithMarkdown,
    charCountWithMd: charCountWithMarkdown,
    lineCountWithoutMd: lineCountWithoutMarkdown,
  });
};

export const processText = (content: string): TextStats => {
  if (content.length > CONFIG.ASYNC_THRESHOLD) {
    throw new Error(
      `Input exceeds sync threshold (${CONFIG.ASYNC_THRESHOLD}). Use processTextAsync() instead.`
    );
  }
  return calculateTextStats(content);
};

export const processTextAsync = async (content: string): Promise<TextStats> => {
  return calculateTextStatsAsync(content);
};
