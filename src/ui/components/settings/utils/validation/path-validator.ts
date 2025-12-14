import {
    RESERVED_FILENAMES_SET,
    REGEX_PATTERNS
} from '@/ui/components/settings/utils/helpers/constants';

/**
 * Validates path segments individually to prevent hidden traversal
 */
export function validatePathSegments(path: string): { isValid: boolean; invalidSegment?: string } {
    const segments = path.split('/');

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]?.trim() ?? '';

        // Empty segment (except when it's the first and path starts with / - but we don't allow that)
        if (segment === '' && i > 0) {
            return { isValid: false, invalidSegment: 'empty segment' };
        }

        // Check for reserved filenames (case-insensitive)
        if (RESERVED_FILENAMES_SET.has(segment.toLowerCase())) {
            return { isValid: false, invalidSegment: segment };
        }

        // Check for invalid characters
        if (REGEX_PATTERNS.INVALID_FILENAME_CHARS.test(segment)) {
            return { isValid: false, invalidSegment: segment };
        }

        // Check for trailing dots or spaces (Windows restriction)
        if (segment.endsWith('.') || segment.endsWith(' ')) {
            return { isValid: false, invalidSegment: segment };
        }

        // Check for control characters
        if (REGEX_PATTERNS.CONTROL_CHARS.test(segment)) {
            return { isValid: false, invalidSegment: segment };
        }
    }

    return { isValid: true };
}
