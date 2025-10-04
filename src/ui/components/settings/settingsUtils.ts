// Enhanced type safety with strict validation
export const validateNumber = (value: unknown, min: number, max: number): number => {
    const num = Number(value);
    if (isNaN(num) || !isFinite(num)) {
        throw new Error(`Invalid number value: ${value}`);
    }
    if (num < min || num > max) {
        throw new Error(`Number ${num} is outside valid range [${min}, ${max}]`);
    }
    return num;
};

export const validateString = (value: unknown, maxLength?: number): string => {
    if (typeof value !== 'string') {
        throw new Error(`Expected string, got ${typeof value}`);
    }
    if (maxLength && value.length > maxLength) {
        throw new Error(`String length exceeds maximum of ${maxLength}`);
    }
    return value;
};

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
