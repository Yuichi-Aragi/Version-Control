import { z } from 'zod';

// Pre-defined schemas for reuse and better performance
const numberSchema = (min: number, max: number) => z.number().min(min).max(max);
const stringSchema = (maxLength?: number) => {
  let schema = z.string();
  if (maxLength !== undefined) {
    schema = schema.max(maxLength);
  }
  return schema;
};

/**
 * Validates if a value is a number within a specified range using Zod.
 * @param value - The value to validate.
 * @param min - The minimum allowed value.
 * @param max - The maximum allowed value.
 * @returns The validated number.
 * @throws {z.ZodError} If validation fails.
 */
export const validateNumber = (value: unknown, min: number, max: number): number => {
  // Input validation for min and max
  if (typeof min !== 'number' || typeof max !== 'number' || isNaN(min) || isNaN(max)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: 'Invalid range parameters',
        path: [],
      },
    ]);
  }
  
  if (min > max) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: 'Min value cannot be greater than max value',
        path: [],
      },
    ]);
  }
  
  return numberSchema(min, max).parse(value);
};

/**
 * Validates if a value is a string, optionally checking its maximum length, using Zod.
 * @param value - The value to validate.
 * @param maxLength - The maximum allowed string length.
 * @returns The validated string.
 * @throws {z.ZodError} If validation fails.
 */
export const validateString = (value: unknown, maxLength?: number): string => {
  // Input validation for maxLength
  if (maxLength !== undefined && (typeof maxLength !== 'number' || isNaN(maxLength) || maxLength < 0)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: 'Invalid maxLength parameter',
        path: [],
      },
    ]);
  }
  
  return stringSchema(maxLength).parse(value);
};

/**
 * Parses a time interval string (e.g., "90", "1:30") into seconds.
 * @param value The string to parse.
 * @returns The total number of seconds, or null if the format is invalid.
 */
export const parseIntervalToSeconds = (value: unknown): number | null => {
  // Validate input is a string
  if (typeof value !== 'string') {
    return null;
  }
  
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // Handle mm:ss format
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    
    // Validate format
    if (parts.length !== 2) {
      return null;
    }
    
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    
    // Validate numeric values
    if (isNaN(minutes) || isNaN(seconds)) {
      return null;
    }
    
    // Validate range
    if (minutes < 0 || seconds < 0 || seconds >= 60) {
      return null;
    }
    
    // Check for potential overflow
    if (minutes > Math.floor(Number.MAX_SAFE_INTEGER / 60)) {
      return null;
    }
    
    const totalSeconds = minutes * 60 + seconds;
    
    // Final safety check
    if (totalSeconds > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    
    return totalSeconds;
  }

  // Handle plain number format
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER) {
    return num;
  }

  return null;
};

/**
 * Formats a duration in seconds into a human-readable string for display (e.g., "1 min 30 sec").
 * @param seconds - The duration in seconds.
 * @returns A formatted string representation of the interval.
 */
export const formatInterval = (seconds: unknown): string => {
  try {
    const validatedSeconds = validateNumber(seconds, 0, Number.MAX_SAFE_INTEGER);
    
    if (validatedSeconds < 60) {
      return `${validatedSeconds} sec`;
    }
    
    const minutes = Math.floor(validatedSeconds / 60);
    const remainingSeconds = validatedSeconds % 60;
    
    return remainingSeconds === 0 
      ? `${minutes} min` 
      : `${minutes} min ${remainingSeconds} sec`;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return 'Invalid interval';
    }
    console.error('Unexpected error formatting interval:', error);
    return 'Error';
  }
};

/**
 * Formats a duration in seconds into a string suitable for an input field (e.g., "90", "1:30").
 * @param seconds The duration in seconds.
 * @returns A formatted string for editing.
 */
export const formatSecondsToInput = (seconds: unknown): string => {
  try {
    const validatedSeconds = Math.round(validateNumber(seconds, 0, Number.MAX_SAFE_INTEGER));
    
    if (validatedSeconds < 60) {
      return String(validatedSeconds);
    }
    
    const minutes = Math.floor(validatedSeconds / 60);
    const remainingSeconds = validatedSeconds % 60;
    
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return '0';
    }
    console.error('Unexpected error formatting seconds to input:', error);
    return '0';
  }
};
