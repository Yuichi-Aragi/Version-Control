import { REGEX_PATTERNS } from '@/ui/components/settings/utils/helpers/constants';

/**
 * Parses interval string to seconds with validation
 */
export const parseIntervalToSeconds = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 20) return null;

    // Check for mm:ss format first (most common)
    const timeMatch = REGEX_PATTERNS.TIME_FORMAT.exec(trimmed);
    if (timeMatch && timeMatch[1] && timeMatch[2]) {
        const minutes = parseInt(timeMatch[1], 10);
        const seconds = parseInt(timeMatch[2], 10);

        if (seconds >= 60) return null;

        const totalSeconds = minutes * 60 + seconds;
        if (totalSeconds <= Number.MAX_SAFE_INTEGER) {
            return totalSeconds;
        }
        return null;
    }

    // Check for seconds-only format
    if (REGEX_PATTERNS.DIGITS_ONLY.test(trimmed)) {
        const seconds = parseInt(trimmed, 10);
        if (seconds <= Number.MAX_SAFE_INTEGER) {
            return seconds;
        }
    }

    return null;
};

/**
 * Formats seconds to human-readable interval
 */
export const formatInterval = (seconds: unknown): string => {
    // Fast type and value checks
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return 'Invalid';
    }

    const s = Math.floor(seconds);
    if (s === 0) return '0 sec';

    if (s < 60) return `${s} sec`;

    const minutes = Math.floor(s / 60);
    const remainingSeconds = s % 60;

    if (remainingSeconds === 0) return `${minutes} min`;
    return `${minutes} min ${remainingSeconds} sec`;
};

/**
 * Formats seconds to input string (mm:ss or ss)
 */
export const formatSecondsToInput = (seconds: unknown): string => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return '0';
    }

    const s = Math.round(seconds);
    if (s < 60) return s.toString();

    const minutes = Math.floor(s / 60);
    const remainingSeconds = s % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};
