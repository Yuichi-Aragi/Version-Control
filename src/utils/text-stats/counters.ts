/**
 * @fileoverview Unicode-aware text counting utilities
 *
 * Provides word, character (grapheme), code point, and line counting
 * with full Unicode support using Intl.Segmenter when available.
 */

import { validateTextInput } from '@/utils/text-stats/validation';

/**
 * WORD COUNTING (Unicode-aware)
 * ============================================================================
 */

const createWordCounter = (): ((text: string) => number) => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

    return (text: string): number => {
      if (text.length === 0) return 0;

      let count = 0;
      for (const segment of segmenter.segment(text)) {
        if (segment.isWordLike) {
          count += 1;
        }
      }
      return count;
    };
  }

  const wordPattern = /[\p{L}\p{N}]+(?:['\u2019][\p{L}]+)?/gu;

  return (text: string): number => {
    if (text.length === 0) return 0;

    const matches = text.match(wordPattern);
    return matches !== null ? matches.length : 0;
  };
};

const countWordsImpl = createWordCounter();

/**
 * CHARACTER COUNTING
 * ============================================================================
 */

const createCharCounter = (): ((text: string) => number) => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

    return (text: string): number => {
      if (text.length === 0) return 0;

      let count = 0;
      for (const _ of segmenter.segment(text)) {
        count += 1;
      }
      return count;
    };
  }

  return (text: string): number => {
    if (text.length === 0) return 0;
    return [...text].length;
  };
};

const countGraphemesImpl = createCharCounter();

const countCodePoints = (text: string): number => {
  if (text.length === 0) return 0;
  return [...text].length;
};

/**
 * LINE COUNTING
 * ============================================================================
 */

const countLinesImpl = (text: string): number => {
  if (text.length === 0) return 0;

  let count = 1;
  const length = text.length;

  for (let i = 0; i < length; i += 1) {
    const char = text.charCodeAt(i);

    if (char === 0x0A) {
      count += 1;
    } else if (char === 0x0D) {
      if (i + 1 < length && text.charCodeAt(i + 1) === 0x0A) {
        i += 1;
      }
      count += 1;
    }
  }

  return count;
};

/**
 * PUBLIC API
 * ============================================================================
 */

export const countWords = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countWordsImpl(validated);
};

export const countChars = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countGraphemesImpl(validated);
};

export const countCharsCodePoints = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countCodePoints(validated);
};

export const countLines = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countLinesImpl(validated);
};

/**
 * INTERNAL EXPORTS (for stats-calculator)
 * ============================================================================
 */

export { countWordsImpl, countGraphemesImpl, countCodePoints as countCodePointsImpl, countLinesImpl };
