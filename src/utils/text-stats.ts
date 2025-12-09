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
import * as v from 'valibot';
import { memoize, isNil } from 'es-toolkit';

/**
 * CONFIGURATION CONSTANTS
 * ============================================================================
 */

const CONFIG = Object.freeze({
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
 * CUSTOM ERROR CLASSES
 * ============================================================================
 */

class SecurityError extends Error {
  readonly code = 'SECURITY_VIOLATION' as const;
  readonly timestamp: number;

  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}

class ValidationError extends Error {
  readonly code = 'VALIDATION_FAILURE' as const;
  readonly paramName: string;
  readonly issues: readonly v.BaseIssue<unknown>[];

  constructor(
    paramName: string,
    message: string,
    issues: readonly v.BaseIssue<unknown>[] = []
  ) {
    super(message);
    this.name = 'ValidationError';
    this.paramName = paramName;
    this.issues = freeze(issues);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

class ResourceError extends Error {
  readonly code = 'RESOURCE_EXHAUSTION' as const;
  readonly resource: string;
  readonly limit: number;
  readonly actual: number;

  constructor(resource: string, limit: number, actual: number) {
    super(`Resource "${resource}" exceeded: limit=${limit}, actual=${actual}`);
    this.name = 'ResourceError';
    this.resource = resource;
    this.limit = limit;
    this.actual = actual;
    Object.setPrototypeOf(this, ResourceError.prototype);
  }
}

/**
 * VALIBOT SCHEMAS
 * ============================================================================
 */

const SecurityPatternSchema = v.pipe(
  v.string(),
  v.check(
    (input) => !/(?:__proto__|constructor\.prototype|constructor\["prototype"\]|constructor\.constructor)/i.test(input),
    'Prototype pollution pattern detected'
  )
);

const TextInputSchema = v.pipe(
  v.string(),
  v.maxLength(CONFIG.MAX_INPUT_LENGTH, `Input exceeds maximum length of ${CONFIG.MAX_INPUT_LENGTH}`),
  SecurityPatternSchema
);

const TextInputOptionsSchema = v.object({
  allowEmpty: v.optional(v.boolean(), true),
  sanitizeControlChars: v.optional(v.boolean(), true),
  maxLength: v.optional(v.number(), CONFIG.MAX_INPUT_LENGTH),
});

type TextInputOptions = Partial<v.InferOutput<typeof TextInputOptionsSchema>>;

/**
 * REGEX CACHE (LRU, Pure)
 * ============================================================================
 */

interface CacheEntry {
  readonly regex: RegExp;
  readonly createdAt: number;
  accessCount: number;
}

const createRegexCache = () => {
  const cache = new Map<string, CacheEntry>();

  const evictLRU = (): void => {
    if (cache.size < CONFIG.MAX_CACHE_SIZE) return;

    let lruKey: string | null = null;
    let minAccess = Infinity;

    for (const [key, entry] of cache) {
      if (entry.accessCount < minAccess) {
        minAccess = entry.accessCount;
        lruKey = key;
      }
    }

    if (lruKey !== null) {
      cache.delete(lruKey);
    }
  };

  const validateFlags = (flags: string): string => {
    const valid = new Set<string>();
    for (const char of flags) {
      if ('gimsuy'.includes(char)) {
        valid.add(char);
      }
    }
    return [...valid].sort().join('');
  };

  const get = (pattern: string, flags: string = ''): RegExp => {
    if (pattern.length > CONFIG.MAX_PATTERN_LENGTH) {
      throw new ResourceError('regexPattern', CONFIG.MAX_PATTERN_LENGTH, pattern.length);
    }

    const validatedFlags = validateFlags(flags);
    const key = `${pattern}\x00${validatedFlags}`;

    const existing = cache.get(key);
    if (existing !== undefined) {
      existing.accessCount += 1;
      const cloned = new RegExp(existing.regex.source, existing.regex.flags);
      return cloned;
    }

    evictLRU();

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, validatedFlags);
    } catch {
      throw new ValidationError('regexPattern', `Invalid regular expression: ${pattern}`, []);
    }

    cache.set(key, {
      regex,
      createdAt: Date.now(),
      accessCount: 1,
    });

    return new RegExp(regex.source, regex.flags);
  };

  const clear = (): void => {
    cache.clear();
  };

  const size = (): number => cache.size;

  return freeze({ get, clear, size });
};

const RegexCache = createRegexCache();

/**
 * YIELD UTILITIES (Non-blocking)
 * ============================================================================
 */

const yieldToMain = (): Promise<void> => {
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

const shouldYield = (() => {
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
 * VALIDATION UTILITIES
 * ============================================================================
 */

const validateTextInput = (
  value: unknown,
  paramName: string,
  options: TextInputOptions = {}
): string => {
  const opts = v.parse(TextInputOptionsSchema, options) as Required<TextInputOptions>;

  if (isNil(value)) {
    throw new ValidationError(paramName, `Parameter "${paramName}" is required`, []);
  }

  const parseResult = v.safeParse(TextInputSchema, value);

  if (!parseResult.success) {
    throw new ValidationError(
      paramName,
      `Invalid parameter "${paramName}": ${parseResult.issues.map((i) => i.message).join(', ')}`,
      parseResult.issues
    );
  }

  let text = parseResult.output;

  if (typeof Blob !== 'undefined') {
    const byteSize = new Blob([text]).size;
    if (byteSize > CONFIG.MAX_INPUT_BYTES) {
      throw new ResourceError(paramName, CONFIG.MAX_INPUT_BYTES, byteSize);
    }
  }

  if (text.length > opts.maxLength) {
    throw new ResourceError(paramName, opts.maxLength, text.length);
  }

  if (opts.sanitizeControlChars) {
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  if (!opts.allowEmpty && text.trim().length === 0) {
    throw new ValidationError(paramName, `Parameter "${paramName}" must not be empty`, []);
  }

  return text;
};

/**
 * MARKDOWN PATTERNS
 * ============================================================================
 */

interface MarkdownPattern {
  readonly pattern: string;
  readonly flags: string;
  readonly replacement: string | ((match: string, ...groups: string[]) => string);
  readonly priority: number;
}

const MARKDOWN_PATTERNS: readonly MarkdownPattern[] = freeze([
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

/**
 * CORE TEXT PROCESSING FUNCTIONS
 * ============================================================================
 */

const applyPatterns = (
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

const applyPatternsAsync = async (
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

const normalizeWhitespace = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^ +| +$/gm, '')
    .trim();
};

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
 * MEMOIZED HELPERS
 * ============================================================================
 */

const memoizedNormalize = memoize(normalizeWhitespace);

/**
 * PUBLIC API
 * ============================================================================
 */

const stripMarkdown = (text: string): string => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return '';
  }

  const stripped = applyPatterns(validated, MARKDOWN_PATTERNS);
  const normalized = memoizedNormalize(stripped);

  return normalized;
};

const stripMarkdownAsync = async (text: string): Promise<string> => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return '';
  }

  const stripped = await applyPatternsAsync(validated, MARKDOWN_PATTERNS);
  await yieldToMain();
  const normalized = normalizeWhitespace(stripped);

  return normalized;
};

const countWords = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countWordsImpl(validated);
};

const countChars = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countGraphemesImpl(validated);
};

const countCharsCodePoints = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countCodePoints(validated);
};

const countLines = (text: string): number => {
  const validated = validateTextInput(text, 'text', { allowEmpty: true });

  if (validated.length === 0) {
    return 0;
  }

  return countLinesImpl(validated);
};

/**
 * TEXT STATISTICS INTERFACE
 * ============================================================================
 */

interface TextStats {
  readonly wordCount: number;
  readonly wordCountWithMarkdown: number;
  readonly charCount: number;
  readonly charCountWithMarkdown: number;
  readonly codePointCount: number;
  readonly codePointCountWithMarkdown: number;
  readonly lineCount: number;
  readonly lineCountWithoutMarkdown: number;
  readonly processingTimeMs: number;
  // Aliases for backward compatibility
  readonly wordCountWithMd: number;
  readonly charCountWithMd: number;
  readonly lineCountWithoutMd: number;
}

const calculateTextStats = (content: string): TextStats => {
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
    codePointCount: countCodePoints(stripped),
    codePointCountWithMarkdown: countCodePoints(validated),
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

const calculateTextStatsAsync = async (content: string): Promise<TextStats> => {
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
  const codePointCount = countCodePoints(stripped);
  const codePointCountWithMarkdown = countCodePoints(validated);

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

const processText = (content: string): TextStats => {
  if (content.length > CONFIG.ASYNC_THRESHOLD) {
    throw new Error(
      `Input exceeds sync threshold (${CONFIG.ASYNC_THRESHOLD}). Use processTextAsync() instead.`
    );
  }
  return calculateTextStats(content);
};

const processTextAsync = async (content: string): Promise<TextStats> => {
  return calculateTextStatsAsync(content);
};

/**
 * UTILITY FUNCTIONS
 * ============================================================================
 */

const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

const validateAndSanitizeString = (
  value: unknown,
  paramName: string,
  options: TextInputOptions = {}
): string => {
  return validateTextInput(value, paramName, options);
};

const clearCache = (): void => {
  RegexCache.clear();
};

const getCacheStats = (): { size: number; maxSize: number } => {
  return freeze({
    size: RegexCache.size(),
    maxSize: CONFIG.MAX_CACHE_SIZE,
  });
};

/**
 * EXPORTS
 * ============================================================================
 */

export {
  SecurityError,
  ValidationError,
  ResourceError,
};

export {
  stripMarkdown,
  stripMarkdownAsync,
  countWords,
  countChars,
  countCharsCodePoints,
  countLines,
  calculateTextStats,
  calculateTextStatsAsync,
  processText,
  processTextAsync,
};

export {
  validateAndSanitizeString,
  isString,
  clearCache,
  getCacheStats,
};

export type {
  TextStats,
  TextInputOptions,
};

export { CONFIG, MARKDOWN_PATTERNS };
