/**
 * @fileoverview Type definitions for text-stats module
 *
 * Defines all TypeScript interfaces, types, and error classes used across
 * the text processing system.
 */

import { freeze } from 'immer';
import type * as v from 'valibot';

/**
 * CUSTOM ERROR CLASSES
 * ============================================================================
 */

export class SecurityError extends Error {
  readonly code = 'SECURITY_VIOLATION' as const;
  readonly timestamp: number;

  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}

export class ValidationError extends Error {
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

export class ResourceError extends Error {
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
 * TEXT STATISTICS INTERFACE
 * ============================================================================
 */

export interface TextStats {
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

/**
 * TEXT INPUT OPTIONS
 * ============================================================================
 */

export interface TextInputOptions {
  allowEmpty?: boolean;
  sanitizeControlChars?: boolean;
  maxLength?: number;
}

/**
 * MARKDOWN PATTERN
 * ============================================================================
 */

export interface MarkdownPattern {
  readonly pattern: string;
  readonly flags: string;
  readonly replacement: string | ((match: string, ...groups: string[]) => string);
  readonly priority: number;
}

/**
 * CACHE ENTRY
 * ============================================================================
 */

export interface CacheEntry {
  readonly regex: RegExp;
  readonly createdAt: number;
  accessCount: number;
}
