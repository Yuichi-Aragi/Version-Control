import type { BoundedNumber, SafeFilename, SafeFrontmatterKey } from '@/ui/components/settings/utils/types';
import {
    RESERVED_FILENAMES,
    RESERVED_FRONTMATTER_KEYS_SET,
    REGEX_PATTERNS
} from '@/ui/components/settings/utils/helpers/constants';

/**
 * Type guard for BoundedNumber type
 */
export function isBoundedNumber<T extends number, U extends number>(
    value: unknown,
    min: T,
    max: U
): value is BoundedNumber<T, U> {
    return typeof value === 'number' &&
           Number.isFinite(value) &&
           value >= min &&
           value <= max;
}

/**
 * Type guard for SafeFilename type
 */
export function isSafeFilename(value: unknown): value is SafeFilename {
    if (typeof value !== 'string') return false;
    if (value.length === 0 || value.length > 255) return false;
    if (REGEX_PATTERNS.INVALID_FILENAME_CHARS.test(value)) return false;
    if (REGEX_PATTERNS.CONTROL_CHARS.test(value)) return false;
    if (value.endsWith('.') || value.endsWith(' ')) return false;

    const upperValue = value.toUpperCase();
    for (const reserved of RESERVED_FILENAMES) {
        if (upperValue === reserved) return false;
    }

    return true;
}

/**
 * Type guard for SafeFrontmatterKey type
 */
export function isSafeFrontmatterKey(value: unknown): value is SafeFrontmatterKey {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 50) return false;
    if (!REGEX_PATTERNS.SAFE_KEY.test(trimmed)) return false;
    if (RESERVED_FRONTMATTER_KEYS_SET.has(trimmed.toLowerCase())) return false;
    return true;
}
