import * as v from 'valibot';

/**
 * Schema validation utilities for generic validation tasks.
 */

/**
 * Safe parse result wrapper.
 */
export interface SafeParseResult<T> {
    success: boolean;
    data?: T;
    issues?: Record<string, string[] | undefined>;
}

/**
 * Performs a safe parse with valibot and returns a normalized result.
 *
 * @param schema - The valibot schema to use for validation
 * @param data - The data to validate
 * @returns Normalized validation result
 */
export function safeValidate<T>(
    schema: v.GenericSchema<T>,
    data: unknown
): SafeParseResult<T> {
    const result = v.safeParse(schema, data);
    if (result.success) {
        return { success: true, data: result.output };
    }
    const flattened = v.flatten(result.issues);
    return {
        success: false,
        issues: flattened.nested as Record<string, string[] | undefined>,
    };
}

/**
 * Validates data and throws if invalid.
 *
 * @param schema - The valibot schema to use for validation
 * @param data - The data to validate
 * @returns The validated data
 * @throws If validation fails
 */
export function strictValidate<T>(
    schema: v.GenericSchema<T>,
    data: unknown
): T {
    return v.parse(schema, data);
}
