import { z } from 'zod';

/**
 * Validates if a value is a number within a specified range using Zod.
 * @param value - The value to validate.
 * @param min - The minimum allowed value.
 * @param max - The maximum allowed value.
 * @returns The validated number.
 * @throws {z.ZodError} If validation fails.
 */
export const validateNumber = (value: unknown, min: number, max: number): number => {
    return z.number().min(min).max(max).parse(value);
};

/**
 * Validates if a value is a string, optionally checking its maximum length, using Zod.
 * @param value - The value to validate.
 * @param maxLength - The maximum allowed string length.
 * @returns The validated string.
 * @throws {z.ZodError} If validation fails.
 */
export const validateString = (value: unknown, maxLength?: number): string => {
    let schema = z.string();
    if (maxLength !== undefined) {
        schema = schema.max(maxLength);
    }
    return schema.parse(value);
};

/**
 * Formats a duration in seconds into a human-readable string (e.g., "1 min 30 sec").
 * @param seconds - The duration in seconds.
 * @returns A formatted string representation of the interval.
 */
export const formatInterval = (seconds: number): string => {
    try {
        const validatedSeconds = validateNumber(seconds, 0, Number.MAX_SAFE_INTEGER);
        if (validatedSeconds < 60) return `${validatedSeconds} sec`;
        const minutes = Math.floor(validatedSeconds / 60);
        const remainingSeconds = validatedSeconds % 60;
        return remainingSeconds === 0 ? `${minutes} min` : `${minutes} min ${remainingSeconds} sec`;
    } catch (error) {
        console.error('Error formatting interval:', error);
        return 'Invalid interval';
    }
};
