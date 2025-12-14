/**
 * @fileoverview LRU regex caching for performance optimization
 *
 * Implements a Least Recently Used (LRU) cache for compiled regular expressions
 * to avoid repeated compilation overhead.
 */

import { freeze } from 'immer';
import { CONFIG } from '@/utils/text-stats/config';
import { ValidationError, ResourceError } from '@/utils/text-stats/types';
import type { CacheEntry } from '@/utils/text-stats/types';

/**
 * REGEX CACHE (LRU, Pure)
 * ============================================================================
 */

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

export const RegexCache = createRegexCache();
