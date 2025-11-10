import { z, ZodError, ZodIssueCode } from 'zod';

/**
 * Cache for Zod schemas to improve performance by avoiding recreation.
 * Pre-defined schemas for reuse and better performance.
 */
const schemaCache = new Map<string, z.ZodTypeAny>();

/**
 * Gets or creates a cached number schema with the specified range.
 * @param min The minimum allowed value.
 * @param max The maximum allowed value.
 * @returns A Zod schema for number validation.
 */
const getNumberSchema = (min: number, max: number): z.ZodNumber => {
  // Input validation with fail-fast approach
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new ZodError([{
      code: ZodIssueCode.custom,
      message: 'Invalid range parameters: min and max must be finite numbers',
      path: [],
    }]);
  }
  
  if (min > max) {
    throw new ZodError([{
      code: ZodIssueCode.custom,
      message: 'Min value cannot be greater than max value',
      path: [],
    }]);
  }
  
  // Check for safe integer bounds
  if (min < Number.MIN_SAFE_INTEGER || max > Number.MAX_SAFE_INTEGER) {
    throw new ZodError([{
      code: ZodIssueCode.custom,
      message: 'Range parameters must be within safe integer bounds',
      path: [],
    }]);
  }
  
  // Create cache key for O(1) lookup
  const cacheKey = `number:${min}:${max}`;
  const cached = schemaCache.get(cacheKey);
  if (cached) {
    return cached as z.ZodNumber;
  }
  
  // Create and cache new schema
  const schema = z.number().min(min).max(max);
  schemaCache.set(cacheKey, schema);
  
  // Implement cache size limit to prevent memory leaks
  if (schemaCache.size > 50) {
    const keys = Array.from(schemaCache.keys());
    const toRemove = keys.slice(0, Math.floor(keys.length * 0.3));
    toRemove.forEach(key => schemaCache.delete(key));
  }
  
  return schema;
};

/**
 * Gets or creates a cached string schema with optional length constraint.
 * @param maxLength The maximum allowed string length.
 * @returns A Zod schema for string validation.
 */
const getStringSchema = (maxLength?: number): z.ZodString => {
  // Input validation with comprehensive checks
  if (maxLength !== undefined) {
    if (typeof maxLength !== 'number' || !Number.isFinite(maxLength) || maxLength < 0) {
      throw new ZodError([{
        code: ZodIssueCode.custom,
        message: 'Invalid maxLength parameter: must be a non-negative finite number',
        path: [],
      }]);
    }
    
    if (maxLength > Number.MAX_SAFE_INTEGER) {
      throw new ZodError([{
        code: ZodIssueCode.custom,
        message: 'maxLength must be within safe integer bounds',
        path: [],
      }]);
    }
  }
  
  // Create cache key for O(1) lookup
  const cacheKey = `string:${maxLength ?? 'unlimited'}`;
  const cached = schemaCache.get(cacheKey);
  if (cached) {
    return cached as z.ZodString;
  }
  
  // Create and cache new schema
  let schema = z.string();
  if (maxLength !== undefined) {
    schema = schema.max(maxLength);
  }
  schemaCache.set(cacheKey, schema);
  
  return schema;
};

/**
 * Compiled regex patterns for improved performance in parseIntervalToSeconds.
 * Cached to avoid recompilation on every call.
 */
const REGEX_PATTERNS = {
  digitsOnly: /^\d+$/,
  timeFormat: /^(\d+):(\d{1,2})$/,
  isValidTimeString: /^\d+:\d{1,2}$/,
} as const;

/**
 * Validates if a value is a number within a specified range using Zod.
 * Enhanced with comprehensive error handling and performance optimizations.
 * @param value The value to validate.
 * @param min The minimum allowed value.
 * @param max The maximum allowed value.
 * @returns The validated number.
 * @throws {ZodError} If validation fails.
 */
export const validateNumber = (value: unknown, min: number, max: number): number => {
  try {
    // Comprehensive input validation
    if (value === null || value === undefined) {
      throw new ZodError([{
        code: ZodIssueCode.custom,
        message: 'Value cannot be null or undefined',
        path: [],
      }]);
    }
    
    const schema = getNumberSchema(min, max);
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw error;
    }
    // Convert any unexpected errors to ZodError for consistency
    const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
    throw new ZodError([{
      code: ZodIssueCode.custom,
      message: `Unexpected validation error: ${errorMessage}`,
      path: [],
    }]);
  }
};

/**
 * Validates if a value is a string, optionally checking its maximum length, using Zod.
 * Enhanced with comprehensive validation and error handling.
 * @param value The value to validate.
 * @param maxLength The maximum allowed string length.
 * @returns The validated string.
 * @throws {ZodError} If validation fails.
 */
export const validateString = (value: unknown, maxLength?: number): string => {
  try {
    // Comprehensive input validation
    if (value === null || value === undefined) {
      throw new ZodError([{
        code: ZodIssueCode.custom,
        message: 'Value cannot be null or undefined',
        path: [],
      }]);
    }
    
    const schema = getStringSchema(maxLength);
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw error;
    }
    // Convert any unexpected errors to ZodError for consistency
    const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
    throw new ZodError([{
      code: ZodIssueCode.custom,
      message: `Unexpected validation error: ${errorMessage}`,
      path: [],
    }]);
  }
};

/**
 * Type guard to check if a value is a valid time interval string.
 * @param value The value to check.
 * @returns True if the value is a valid time interval string.
 */
const isValidTimeInterval = (value: unknown): value is string => {
  return typeof value === 'string' && 
         value.length > 0 && 
         value.length <= 20 && // Reasonable length limit
         (REGEX_PATTERNS.digitsOnly.test(value) || REGEX_PATTERNS.isValidTimeString.test(value));
};

/**
 * Parses a time interval string (e.g., "90", "1:30") into seconds.
 * Enhanced with comprehensive validation, security hardening, and performance optimization.
 * @param value The string to parse.
 * @returns The total number of seconds, or null if the format is invalid.
 */
export const parseIntervalToSeconds = (value: unknown): number | null => {
  // Quick rejection for invalid input types
  if (!isValidTimeInterval(value)) {
    return null;
  }
  
  const trimmed = value.trim();
  
  // Additional security checks
  if (trimmed.length === 0 || trimmed.length > 20) {
    return null;
  }
  
  try {
    // Handle mm:ss format with enhanced validation
    if (trimmed.includes(':')) {
      // Use compiled regex for better performance and security
      const match = REGEX_PATTERNS.timeFormat.exec(trimmed);
      if (!match || match.length !== 3) {
        return null;
      }
      
      const minutesStr = match[1];
      const secondsStr = match[2];

      if (minutesStr === undefined || secondsStr === undefined) {
        return null;
      }
      
      // Additional validation for empty parts
      if (minutesStr.length === 0 || secondsStr.length === 0) {
        return null;
      }
      
      // Parse with bounds checking
      const minutes = Number.parseInt(minutesStr, 10);
      const seconds = Number.parseInt(secondsStr, 10);
      
      // Validate parsing results
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || 
          minutes < 0 || seconds < 0 || seconds >= 60) {
        return null;
      }
      
      // Check for potential overflow before calculation
      if (minutes > Math.floor(Number.MAX_SAFE_INTEGER / 60)) {
        return null;
      }
      
      const totalSeconds = minutes * 60 + seconds;
      
      // Final safety check for overflow
      if (!Number.isFinite(totalSeconds) || totalSeconds < 0 || totalSeconds > Number.MAX_SAFE_INTEGER) {
        return null;
      }
      
      return totalSeconds;
    }

    // Handle plain number format with enhanced validation
    if (!REGEX_PATTERNS.digitsOnly.test(trimmed)) {
      return null;
    }
    
    const num = Number.parseInt(trimmed, 10);
    
    // Comprehensive validation of the parsed number
    if (!Number.isFinite(num) || num < 0 || num > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    
    return num;
  } catch (error) {
    // Graceful degradation for any unexpected errors
    return null;
  }
};

/**
 * Type guard for valid duration values.
 * @param value The value to check.
 * @returns True if the value is a valid duration.
 */
const isValidDuration = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
};

/**
 * Formats a duration in seconds into a human-readable string for display (e.g., "1 min 30 sec").
 * Enhanced with comprehensive validation and performance optimization.
 * @param seconds The duration in seconds.
 * @returns A formatted string representation of the interval.
 */
export const formatInterval = (seconds: unknown): string => {
  try {
    // Comprehensive input validation with fail-fast approach
    if (!isValidDuration(seconds)) {
      return 'Invalid interval';
    }
    
    const validatedSeconds = Math.floor(seconds);
    
    // Early return for zero case
    if (validatedSeconds === 0) {
      return '0 sec';
    }
    
    // Performance optimization: avoid unnecessary calculations
    if (validatedSeconds < 60) {
      return `${validatedSeconds} sec`;
    }
    
    // Use integer division for better performance
    const minutes = Math.floor(validatedSeconds / 60);
    const remainingSeconds = validatedSeconds - (minutes * 60);
    
    // Optimized string concatenation
    return remainingSeconds === 0 
      ? `${minutes} min` 
      : `${minutes} min ${remainingSeconds} sec`;
  } catch (error) {
    // Enhanced error logging with structured information
    if (error instanceof ZodError) {
      return 'Invalid interval';
    }
    
    const errorDetails = error instanceof Error 
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error) };
    
    // Structured error logging
    console.error('Unexpected error formatting interval:', {
      timestamp: new Date().toISOString(),
      input: seconds,
      error: errorDetails,
      function: 'formatInterval',
    });
    
    return 'Error';
  }
};

/**
 * Formats a duration in seconds into a string suitable for an input field (e.g., "90", "1:30").
 * Enhanced with comprehensive validation and error handling.
 * @param seconds The duration in seconds.
 * @returns A formatted string for editing.
 */
export const formatSecondsToInput = (seconds: unknown): string => {
  try {
    // Comprehensive input validation
    if (!isValidDuration(seconds)) {
      return '0';
    }
    
    // Use Math.round for better rounding behavior
    const validatedSeconds = Math.round(seconds);
    
    // Early return for zero case
    if (validatedSeconds === 0) {
      return '0';
    }
    
    // Performance optimization: avoid unnecessary calculations
    if (validatedSeconds < 60) {
      return String(validatedSeconds);
    }
    
    // Use integer division for better performance
    const minutes = Math.floor(validatedSeconds / 60);
    const remainingSeconds = validatedSeconds - (minutes * 60);
    
    // Use pre-computed padding for performance
    const secondsStr = remainingSeconds < 10 ? `0${remainingSeconds}` : String(remainingSeconds);
    
    return `${minutes}:${secondsStr}`;
  } catch (error) {
    // Enhanced error logging with structured information
    if (error instanceof ZodError) {
      return '0';
    }
    
    const errorDetails = error instanceof Error 
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error) };
    
    // Structured error logging
    console.error('Unexpected error formatting seconds to input:', {
      timestamp: new Date().toISOString(),
      input: seconds,
      error: errorDetails,
      function: 'formatSecondsToInput',
    });
    
    return '0';
  }
};

/**
 * Validates and converts an unknown value to a safe number within a specified range.
 * Enhanced with comprehensive error handling and type safety.
 * @param value The value to validate and convert.
 * @param min The minimum allowed value.
 * @param max The maximum allowed value.
 * @param defaultValue The default value to return if validation fails.
 * @returns The validated number or default value.
 */
export const safeValidateNumber = (
  value: unknown, 
  min: number, 
  max: number, 
  defaultValue: number = 0
): number => {
  try {
    return validateNumber(value, min, max);
  } catch (error) {
    // Enhanced error logging
    console.warn('Number validation failed, using default value:', {
      value,
      min,
      max,
      defaultValue,
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultValue;
  }
};

/**
 * Validates and converts an unknown value to a safe string with optional length constraint.
 * Enhanced with comprehensive error handling and type safety.
 * @param value The value to validate and convert.
 * @param maxLength The maximum allowed string length.
 * @param defaultValue The default value to return if validation fails.
 * @returns The validated string or default value.
 */
export const safeValidateString = (
  value: unknown, 
  maxLength?: number, 
  defaultValue: string = ''
): string => {
  try {
    return validateString(value, maxLength);
  } catch (error) {
    // Enhanced error logging
    console.warn('String validation failed, using default value:', {
      value,
      maxLength,
      defaultValue,
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultValue;
  }
};
