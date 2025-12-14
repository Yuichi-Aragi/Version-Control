/**
 * Safely checks if a value is null or undefined
 */
export function isNil(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

/**
 * Validates bounds for min and max values
 */
export function validateBounds(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new TypeError('Min and max must be finite numbers');
    }
    if (min > max) {
        throw new RangeError(`Min (${min}) cannot be greater than max (${max})`);
    }
}
