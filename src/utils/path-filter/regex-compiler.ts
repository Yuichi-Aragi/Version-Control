/**
 * REGEX COMPILATION
 *
 * Regex compilation and caching with comprehensive error handling.
 */

import { validatePattern } from '@/utils/path-filter/validation';
import { regexCache } from '@/utils/path-filter/cache';

/** Safely compile and cache regex pattern with comprehensive error handling */
export function compileRegex(pattern: string): RegExp | null {
    // Validate pattern first
    const patternValidation = validatePattern(pattern);
    if (!patternValidation.isValid) {
        console.warn('Version Control: Pattern validation failed:', {
            pattern: patternValidation.sanitized || pattern.substring(0, 50),
            error: patternValidation.error
        });
        return null;
    }

    const validatedPattern = patternValidation.value!;

    // Check cache first
    const cachedRegex = regexCache.get(validatedPattern);
    if (cachedRegex) {
        return cachedRegex;
    }

    try {
        // Attempt compilation
        const regex = new RegExp(validatedPattern);

        // Test compilation with safe input to catch runtime errors early
        const testInput = 'test-string-for-validation';
        regex.test(testInput);

        // Store in cache
        regexCache.set(validatedPattern, regex);

        return regex;
    } catch (error) {
        // Comprehensive error handling with structured logging
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'UnknownError';

        console.warn('Version Control: Regex compilation failed:', {
            pattern: validatedPattern.substring(0, 100),
            patternLength: validatedPattern.length,
            errorType: errorName,
            errorMessage,
            timestamp: new Date().toISOString()
        });

        return null;
    }
}
