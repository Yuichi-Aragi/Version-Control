import { escapeRegExp as lodashEscapeRegExp } from 'lodash-es';

/**
 * Escapes special characters in a string to make it safe for use in regular expressions.
 * This function wraps lodash's escapeRegExp implementation with additional validation.
 * 
 * @param str - The string to escape. Must be a non-null string.
 * @returns The escaped string with special regex characters properly escaped.
 * @throws {TypeError} If the input is not a string.
 * @throws {Error} If the input is null or undefined.
 */
export const escapeRegExp = (str: string): string => {
    // Input validation
    if (str === null || str === undefined) {
        throw new Error('Input cannot be null or undefined');
    }
    
    if (typeof str !== 'string') {
        throw new TypeError(`Expected a string, but received ${typeof str}`);
    }
    
    // Use lodash's implementation
    return lodashEscapeRegExp(str);
};
