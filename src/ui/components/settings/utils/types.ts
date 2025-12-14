import * as v from 'valibot';

/**
 * Represents a validated string that passes filename safety checks
 */
export type SafeFilename = string & { readonly __brand: 'SafeFilename' };

/**
 * Represents a validated string that passes path safety checks
 */
export type SafePath = string & { readonly __brand: 'SafePath' };

/**
 * Represents a validated string that passes frontmatter key safety checks
 */
export type SafeFrontmatterKey = string & { readonly __brand: 'SafeFrontmatterKey' };

/**
 * Represents a validated number within safe bounds
 */
export type BoundedNumber<N extends number, X extends number> = number & {
    readonly __min: N;
    readonly __max: X;
};

/**
 * Cache entry for Valibot schemas
 */
export interface CacheEntry {
    schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
    lastAccess: number;
}

/**
 * Custom validation error class compatible with valibot
 */
export class ValidationError extends Error {
    constructor(message: string, public readonly issues: v.BaseIssue<unknown>[]) {
        super(message);
        this.name = 'ValidationError';
    }
}
