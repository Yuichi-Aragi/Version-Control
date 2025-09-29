import { compare } from 'semver';

/**
 * Compares two semantic version strings using the 'semver' library.
 * @param v1 The first version string (e.g., "1.0.10").
 * @param v2 The second version string (e.g., "1.0.2").
 * @returns 1 if v1 > v2, -1 if v1 < v2, and 0 if v1 === v2.
 */
export const compareVersions = (v1: string, v2: string): number => {
    return compare(v1, v2);
};
