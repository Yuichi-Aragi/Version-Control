/**
 * VALIDATION UTILITIES
 *
 * Comprehensive validation functions with security hardening.
 */

import type { ValidationResult } from '@/utils/path-filter/types';
import {
    MAX_PATTERN_LENGTH,
    MAX_PATH_LENGTH,
    DANGEROUS_REGEX_PATTERNS,
    PATH_TRAVERSAL_PATTERNS,
    RESERVED_NAMES
} from '@/utils/path-filter/config';

/** Comprehensive pattern validation with security checks */
export function validatePattern(pattern: unknown): ValidationResult<string> {
    // Type validation
    if (typeof pattern !== 'string') {
        return {
            isValid: false,
            error: `Invalid pattern type: expected string, got ${typeof pattern}`
        };
    }

    const trimmed = pattern.trim();

    // Empty pattern validation
    if (trimmed.length === 0) {
        return {
            isValid: false,
            error: 'Pattern cannot be empty or whitespace only'
        };
    }

    // Length validation for security
    if (trimmed.length > MAX_PATTERN_LENGTH) {
        return {
            isValid: false,
            error: `Pattern too long: ${trimmed.length} characters (max ${MAX_PATTERN_LENGTH})`,
            sanitized: trimmed.substring(0, 100) + '...'
        };
    }

    // Dangerous pattern detection
    for (const dangerousPattern of DANGEROUS_REGEX_PATTERNS) {
        if (dangerousPattern.test(trimmed)) {
            return {
                isValid: false,
                error: 'Pattern contains potentially dangerous regex constructs',
                sanitized: trimmed
            };
        }
    }

    return {
        isValid: true,
        value: trimmed,
        sanitized: trimmed
    };
}

/** Comprehensive path validation with security hardening */
export function validatePath(path: unknown): ValidationResult<string> {
    // Type validation
    if (typeof path !== 'string') {
        return {
            isValid: false,
            error: `Invalid path type: expected string, got ${typeof path}`
        };
    }

    const trimmed = path.trim();

    // Empty path validation
    if (trimmed.length === 0) {
        return {
            isValid: false,
            error: 'Path cannot be empty or whitespace only'
        };
    }

    // Length validation
    if (trimmed.length > MAX_PATH_LENGTH) {
        return {
            isValid: false,
            error: `Path too long: ${trimmed.length} characters (max ${MAX_PATH_LENGTH})`,
            sanitized: trimmed.substring(0, 100) + '...'
        };
    }

    // Security: Path traversal detection
    for (const traversalPattern of PATH_TRAVERSAL_PATTERNS) {
        if (traversalPattern.test(trimmed)) {
            return {
                isValid: false,
                error: 'Path contains traversal patterns',
                sanitized: trimmed.replace(/\0/g, '').replace(/[\\/]/g, '/')
            };
        }
    }

    // Normalize path separators
    let sanitized = trimmed.replace(/\\/g, '/');

    // Remove any remaining null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Check for reserved names (case-insensitive)
    const segments = sanitized.split('/');
    for (const segment of segments) {
        const upperSegment = segment.toUpperCase();
        if (RESERVED_NAMES.has(upperSegment)) {
            return {
                isValid: false,
                error: `Path contains reserved name: ${segment}`,
                sanitized
            };
        }
    }

    return {
        isValid: true,
        value: sanitized,
        sanitized
    };
}

/** Settings validation with comprehensive type checking */
export function validateSettings(settings: unknown): ValidationResult<readonly string[]> {
    // Null/undefined check
    if (settings == null) {
        return {
            isValid: false,
            error: 'Settings object is null or undefined'
        };
    }

    // Type check
    if (typeof settings !== 'object' || Array.isArray(settings)) {
        return {
            isValid: false,
            error: `Settings must be an object, got ${typeof settings}`
        };
    }

    const settingsObj = settings as Record<string, unknown>;

    // Check for required pathFilters property
    if (!('pathFilters' in settingsObj)) {
        return {
            isValid: false,
            error: 'Settings missing required property: pathFilters'
        };
    }

    const pathFilters = settingsObj['pathFilters'];

    // Type check for pathFilters
    if (!Array.isArray(pathFilters)) {
        return {
            isValid: false,
            error: `pathFilters must be an array, got ${typeof pathFilters}`
        };
    }

    // Validate each filter
    const validFilters: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < pathFilters.length; i++) {
        const filter = pathFilters[i];

        // Skip null/undefined entries
        if (filter == null) {
            continue;
        }

        const validation = validatePattern(filter);
        if (validation.isValid && validation.value) {
            validFilters.push(validation.value);
        } else if (validation.error) {
            errors.push(`Filter at index ${i}: ${validation.error}`);
        }
    }

    if (errors.length > 0 && validFilters.length === 0) {
        return {
            isValid: false,
            error: `All filters invalid: ${errors.join('; ')}`
        };
    }

    return {
        isValid: true,
        value: Object.freeze([...validFilters]) // Return immutable array
    };
}
