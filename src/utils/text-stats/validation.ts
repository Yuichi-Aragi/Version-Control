/**
 * @fileoverview Input validation using Valibot schemas
 *
 * Provides schema-based validation with comprehensive security checks
 * and sanitization for text inputs.
 */

import * as v from 'valibot';
import { isNil } from 'es-toolkit';
import { CONFIG } from '@/utils/text-stats/config';
import { ValidationError, ResourceError } from '@/utils/text-stats/types';
import type { TextInputOptions } from '@/utils/text-stats/types';

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

/**
 * VALIDATION UTILITIES
 * ============================================================================
 */

export const validateTextInput = (
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
