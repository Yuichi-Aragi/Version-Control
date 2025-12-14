/**
 * Utilities Module
 *
 * Exports validation and data transformation utilities.
 */

export {
    isNonEmptyString,
    isArrayBuffer,
    isValidSource,
    isValidNumber,
    validateString,
    validateContent,
    validateStoredEventStructure,
} from './validation';

export {
    decodeContent,
    sanitizeString,
    areStringsEqual,
    compressDiffData,
    decompressDiffData,
    serializeAndTransfer,
    getLockKey,
} from './data-transformer';
