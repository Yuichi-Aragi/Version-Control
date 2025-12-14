import * as v from 'valibot';
import type { BoundedNumber } from '@/ui/components/settings/utils/types';
import { ValidationError } from '@/ui/components/settings/utils/types';
import { isNil } from '@/ui/components/settings/utils/helpers/common-utils';
import { getNumberSchema, getStringSchema } from '@/ui/components/settings/utils/factories/schema-factory';

/**
 * Validates a number with bounds checking and type safety
 */
export const validateNumber = (value: unknown, min: number, max: number): BoundedNumber<typeof min, typeof max> => {
    if (isNil(value)) {
        throw new ValidationError("Value cannot be null or undefined", [{
            kind: 'validation',
            type: 'custom',
            input: value,
            expected: 'number',
            received: String(value),
            message: "Value cannot be null or undefined",

            issues: undefined,
            lang: undefined,
            abortEarly: undefined,
            abortPipeEarly: undefined,
        }]);
    }

    // Fast type check
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw new ValidationError("Value must be a number or numeric string", [{
            kind: 'validation',
            type: 'custom',
            input: value,
            expected: 'number',
            received: typeof value,
            message: "Value must be a number or numeric string",

            issues: undefined,
            lang: undefined,
            abortEarly: undefined,
            abortPipeEarly: undefined,
        }]);
    }

    // Convert string to number if possible
    const numericValue = typeof value === 'string' ? Number(value) : value;

    // Fast NaN and Infinity checks
    if (!Number.isFinite(numericValue)) {
        throw new ValidationError("Value must be a finite number", [{
            kind: 'validation',
            type: 'custom',
            input: value,
            expected: 'finite number',
            received: String(numericValue),
            message: "Value must be a finite number",

            issues: undefined,
            lang: undefined,
            abortEarly: undefined,
            abortPipeEarly: undefined,
        }]);
    }

    try {
        const schema = getNumberSchema(min, max);
        const result = v.parse(schema, numericValue);
        return result as BoundedNumber<typeof min, typeof max>;
    } catch (error) {
        if (error instanceof v.ValiError) {
            throw new ValidationError(error.message, error.issues);
        }
        throw error;
    }
};

/**
 * Validates a string with length constraints
 */
export const validateString = (value: unknown, maxLength?: number): string => {
    if (isNil(value)) {
        throw new ValidationError("Value cannot be null or undefined", [{
            kind: 'validation',
            type: 'custom',
            input: value,
            expected: 'string',
            received: String(value),
            message: "Value cannot be null or undefined",

            issues: undefined,
            lang: undefined,
            abortEarly: undefined,
            abortPipeEarly: undefined,
        }]);
    }

    if (typeof value !== 'string') {
        throw new ValidationError("Value must be a string", [{
            kind: 'validation',
            type: 'custom',
            input: value,
            expected: 'string',
            received: typeof value,
            message: "Value must be a string",

            issues: undefined,
            lang: undefined,
            abortEarly: undefined,
            abortPipeEarly: undefined,
        }]);
    }

    try {
        const schema = getStringSchema(maxLength);
        return v.parse(schema, value) as string;
    } catch (error) {
        if (error instanceof v.ValiError) {
            throw new ValidationError(error.message, error.issues);
        }
        throw error;
    }
};

/**
 * Safe number validation with default fallback
 */
export const safeValidateNumber = (
    value: unknown,
    min: number,
    max: number,
    def: number = 0
): number => {
    try {
        return validateNumber(value, min, max);
    } catch {
        // Ensure default is within bounds
        return Math.max(min, Math.min(max, def));
    }
};

/**
 * Safe string validation with default fallback
 */
export const safeValidateString = (
    value: unknown,
    maxLength?: number,
    def: string = ''
): string => {
    try {
        return validateString(value, maxLength);
    } catch {
        // Truncate default if maxLength specified
        if (maxLength !== undefined && def.length > maxLength) {
            return def.slice(0, maxLength);
        }
        return def;
    }
};
