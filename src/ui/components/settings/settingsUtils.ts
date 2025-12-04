import { z, ZodError, ZodIssueCode, type ZodTypeAny } from 'zod';

// --- Utility Types for Enhanced Type Safety ---

/**
 * Represents a validated string that passes filename safety checks
 */
type SafeFilename = string & { readonly __brand: 'SafeFilename' };

/**
 * Represents a validated string that passes path safety checks
 */
type SafePath = string & { readonly __brand: 'SafePath' };

/**
 * Represents a validated string that passes frontmatter key safety checks
 */
type SafeFrontmatterKey = string & { readonly __brand: 'SafeFrontmatterKey' };

/**
 * Represents a validated number within safe bounds
 */
type BoundedNumber<N extends number, X extends number> = number & { 
    readonly __min: N; 
    readonly __max: X;
};

// --- Cache Optimization with LRU Strategy ---

interface CacheEntry {
    schema: ZodTypeAny;
    lastAccess: number;
}

/**
 * LRU cache for Zod schemas with bounded memory usage
 */
class SchemaCache {
    private static readonly MAX_SIZE = 100;

    private static instance: SchemaCache;
    
    private cache = new Map<string, CacheEntry>();


    private constructor() {}

    static getInstance(): SchemaCache {
        if (!SchemaCache.instance) {
            SchemaCache.instance = new SchemaCache();
        }
        return SchemaCache.instance;
    }

    get<T extends ZodTypeAny>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        // Update access time
        entry.lastAccess = Date.now();
        this.cache.set(key, entry);
        
        return entry.schema as T;
    }

    set(key: string, schema: ZodTypeAny): void {
        // Implement LRU eviction if at capacity
        if (this.cache.size >= SchemaCache.MAX_SIZE) {
            let oldestKey = '';
            let oldestTime = Infinity;
            
            for (const [k, entry] of this.cache.entries()) {
                if (entry.lastAccess < oldestTime) {
                    oldestTime = entry.lastAccess;
                    oldestKey = k;
                }
            }
            
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            schema,
            lastAccess: Date.now()
        });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

// --- Compile-time Constants for Maximum Performance ---

/**
 * Reserved filenames on Windows and other systems (case-insensitive)
 * These cannot be used as folder or file names.
 */
const RESERVED_FILENAMES = Object.freeze([
    'CON', 'PRN', 'AUX', 'NUL', 
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
] as const);

/**
 * Reserved keys in Obsidian frontmatter that we should not overwrite.
 */
const RESERVED_FRONTMATTER_KEYS = Object.freeze([
    'tags', 'aliases', 'cssclass', 'publish', 'date', 'title', 
    'creation date', 'modification date', 'template'
] as const);

/**
 * Precompiled regex patterns for maximum performance
 */
const REGEX_PATTERNS = Object.freeze({
    // Characters strictly forbidden in file/folder names across major OSs
    INVALID_FILENAME_CHARS: /[<>:"|?*\\\x00-\x1F\x7F]/,
    
    // Path traversal detection - optimized pattern
    PATH_TRAVERSAL: /(?:^|[\\/])\.\.(?:[\\/]|$)/,
    
    // Control characters
    CONTROL_CHARS: /[\x00-\x1F\x7F]/,
    
    // Simple frontmatter key validation
    SAFE_KEY: /^[a-z0-9_-]+$/i,
    
    // Time format validation
    TIME_FORMAT: /^(\d+):(\d{1,2})$/,
    
    // Digits only
    DIGITS_ONLY: /^\d+$/,
    
    // Variable extraction
    VARIABLE_EXTRACTION: /{([^}]+)}/g
} as const);

// --- Precomputed Sets for O(1) Lookups ---

const RESERVED_FILENAMES_SET = new Set(RESERVED_FILENAMES.map(s => s.toLowerCase()));
const RESERVED_FRONTMATTER_KEYS_SET = new Set(RESERVED_FRONTMATTER_KEYS.map(s => s.toLowerCase()));

// --- Helper Functions with Performance Optimizations ---

/**
 * Safely checks if a value is null or undefined
 */
function isNil(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

/**
 * Validates bounds for min and max values
 */
function validateBounds(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new TypeError('Min and max must be finite numbers');
    }
    if (min > max) {
        throw new RangeError(`Min (${min}) cannot be greater than max (${max})`);
    }
}

const getNumberSchema = (min: number, max: number): z.ZodNumber => {
    // Validate bounds first (fail-fast)
    validateBounds(min, max);
    
    const cacheKey = `number:${min}:${max}`;
    const cache = SchemaCache.getInstance();
    const cached = cache.get<z.ZodNumber>(cacheKey);
    
    if (cached) return cached;
    
    const schema = z.number()
        .min(min, { message: `Must be at least ${min}` })
        .max(max, { message: `Must be at most ${max}` })
        .finite('Must be a finite number');
    
    cache.set(cacheKey, schema);
    return schema;
};

const getStringSchema = (maxLength?: number): z.ZodString => {
    const cacheKey = `string:${maxLength ?? 'unlimited'}`;
    const cache = SchemaCache.getInstance();
    const cached = cache.get<z.ZodString>(cacheKey);
    
    if (cached) return cached;
    
    let schema = z.string().min(1, 'String cannot be empty');
    
    if (maxLength !== undefined) {
        if (!Number.isFinite(maxLength) || maxLength < 1) {
            throw new RangeError('maxLength must be a finite positive number');
        }
        schema = schema.max(maxLength, `Must be at most ${maxLength} characters`);
    }
    
    cache.set(cacheKey, schema);
    return schema;
};

// --- Strict UI Validation Schemas with Enhanced Security ---

/**
 * Validates path segments individually to prevent hidden traversal
 */
function validatePathSegments(path: string): { isValid: boolean; invalidSegment?: string } {
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

/**
 * Schema for validating the database folder path.
 * Enforces security rules: no traversal, no reserved names, valid characters.
 */
export const DatabasePathSchema = z.string()
    .transform((val: string): string => val.trim())
    .superRefine((val, ctx) => {
        // Fast length check
        if (val.length === 0) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Database path cannot be empty",
                path: []
            });
            return;
        }
        
        if (val.length > 255) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Path is too long (max 255 chars)",
                path: []
            });
            return;
        }
        
        // Check for absolute path
        if (val.startsWith('/')) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Path must be relative (cannot start with /)",
                path: []
            });
            return;
        }
        
        // Check for trailing slash
        if (val.endsWith('/')) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Path cannot end with a slash",
                path: []
            });
            return;
        }
        
        // Check for path traversal
        if (REGEX_PATTERNS.PATH_TRAVERSAL.test(val)) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Path traversal (..) is not allowed",
                path: []
            });
            return;
        }
        
        // Validate all segments
        const segmentValidation = validatePathSegments(val);
        if (!segmentValidation.isValid) {
            const message = segmentValidation.invalidSegment === 'empty segment' 
                ? "Path contains empty segments" 
                : `Path contains invalid segment: '${segmentValidation.invalidSegment}'`;
            
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message,
                path: []
            });
            return;
        }
    });

/**
 * Schema for validating the frontmatter key.
 * Enforces strict YAML-safe key format and avoids Obsidian reserved keys.
 */
export const FrontmatterKeySchema = z.string()
    .transform((val: string): string => val.trim())
    .superRefine((val, ctx) => {
        if (val.length === 0) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Key cannot be empty",
                path: []
            });
            return;
        }
        
        if (val.length > 50) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Key is too long (max 50 chars)",
                path: []
            });
            return;
        }
        
        if (!REGEX_PATTERNS.SAFE_KEY.test(val)) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "Key can only contain letters, numbers, underscores, and hyphens",
                path: []
            });
            return;
        }
        
        if (RESERVED_FRONTMATTER_KEYS_SET.has(val.toLowerCase())) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: `'${val}' is a reserved Obsidian frontmatter key`,
                path: []
            });
            return;
        }
    });

/**
 * Schema for validating a list of Regex patterns (one per line).
 * Checks for syntax errors and potential ReDoS complexity (via length).
 */
export const RegexListSchema = z.string().superRefine((val, ctx) => {
    const lines = val.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? '';
        if (line.length === 0) continue;
        
        // Security: Limit pattern length to prevent massive backtracking potential
        if (line.length > 500) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: `Line ${i + 1}: Pattern too long (>500 chars)`,
                path: [i]
            });
            return;
        }
        
        // Additional security: Check for exponential backtracking patterns
        if (/(?:.*){2,}\?/.test(line) || /\|.*\|/.test(line)) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: `Line ${i + 1}: Pattern may cause exponential backtracking`,
                path: [i]
            });
            return;
        }
        
        try {
            // Use RegExp constructor with validation
            new RegExp(line);
        } catch (e) {
            const error = e as Error;
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: `Line ${i + 1}: Invalid Regex syntax - ${error.message}`,
                path: [i]
            });
            return;
        }
    }
});

/**
 * Factory to create a schema for ID formats with specific allowed variables.
 */
const createIdFormatSchema = (allowedVariables: readonly string[], contextName: string) => {
    const allowedSet = new Set(allowedVariables);
    
    return z.string()
        .transform((val: string): string => val.trim())
        .superRefine((val, ctx) => {
            if (val.length === 0) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `${contextName} format cannot be empty`,
                    path: []
                });
                return;
            }
            
            if (val.length > 100) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `${contextName} format is too long (max 100 chars)`,
                    path: []
                });
                return;
            }
            
            // Check for control characters
            if (REGEX_PATTERNS.CONTROL_CHARS.test(val)) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `${contextName} format contains control characters`,
                    path: []
                });
                return;
            }
            
            // Check balanced braces and extract variables
            let depth = 0;
            let braceStart = -1;
            const foundVariables = new Set<string>();
            
            for (let i = 0; i < val.length; i++) {
                const char = val[i];
                
                if (char === '{') {
                    if (depth > 0) {
                        ctx.addIssue({
                            code: ZodIssueCode.custom,
                            message: `${contextName} format has nested braces`,
                            path: []
                        });
                        return;
                    }
                    depth++;
                    braceStart = i;
                } else if (char === '}') {
                    if (depth === 0) {
                        ctx.addIssue({
                            code: ZodIssueCode.custom,
                            message: `${contextName} format has unmatched closing brace`,
                            path: []
                        });
                        return;
                    }
                    depth--;
                    
                    // Extract variable name
                    const varName = val.slice(braceStart + 1, i);
                    if (varName.length === 0) {
                        ctx.addIssue({
                            code: ZodIssueCode.custom,
                            message: `${contextName} format has empty variable`,
                            path: []
                        });
                        return;
                    }
                    foundVariables.add(varName);
                }
            }
            
            if (depth !== 0) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `${contextName} format has unmatched opening brace`,
                    path: []
                });
                return;
            }
            
            // Check all found variables are allowed
            for (const varName of foundVariables) {
                if (!allowedSet.has(varName)) {
                    ctx.addIssue({
                        code: ZodIssueCode.custom,
                        message: `Unknown variable: {${varName}}. Allowed: ${allowedVariables.map(v => `{${v}}`).join(', ')}`,
                        path: []
                    });
                    return;
                }
            }
            
            // Check for invalid filename chars in static parts
            const staticParts = val.replace(REGEX_PATTERNS.VARIABLE_EXTRACTION, '');
            if (REGEX_PATTERNS.INVALID_FILENAME_CHARS.test(staticParts)) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `${contextName} format contains invalid filename characters in static text`,
                    path: []
                });
                return;
            }
        });
};

export const NoteIdFormatSchema = createIdFormatSchema(['path', 'name', 'timestamp'] as const, 'Note ID');
export const VersionIdFormatSchema = createIdFormatSchema(['timestamp', 'version', 'name'] as const, 'Version ID');

// --- Enhanced Legacy/Shared Validation Functions ---

/**
 * Validates a number with bounds checking and type safety
 */
export const validateNumber = (value: unknown, min: number, max: number): BoundedNumber<typeof min, typeof max> => {
    if (isNil(value)) {
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: "Value cannot be null or undefined",
            path: []
        }]);
    }
    
    // Fast type check
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: "Value must be a number or numeric string",
            path: []
        }]);
    }
    
    // Convert string to number if possible
    const numericValue = typeof value === 'string' ? Number(value) : value;
    
    // Fast NaN and Infinity checks
    if (!Number.isFinite(numericValue)) {
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: "Value must be a finite number",
            path: []
        }]);
    }
    
    try {
        const result = getNumberSchema(min, max).parse(numericValue);
        return result as BoundedNumber<typeof min, typeof max>;
    } catch (error) {
        if (error instanceof ZodError) throw error;
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: `Validation failed: ${(error as Error).message}`,
            path: []
        }]);
    }
};

/**
 * Validates a string with length constraints
 */
export const validateString = (value: unknown, maxLength?: number): string => {
    if (isNil(value)) {
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: "Value cannot be null or undefined",
            path: []
        }]);
    }
    
    if (typeof value !== 'string') {
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: "Value must be a string",
            path: []
        }]);
    }
    
    try {
        return getStringSchema(maxLength).parse(value);
    } catch (error) {
        if (error instanceof ZodError) throw error;
        throw new ZodError([{
            code: ZodIssueCode.custom,
            message: `Validation failed: ${(error as Error).message}`,
            path: []
        }]);
    }
};

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

/**
 * Safe number validation with default fallback
 */
export const safeValidateNumber = (
    value: unknown, 
    min: number, 
    max: number, 
    def: number = 0
): number => {
    try {
        return validateNumber(value, min, max);
    } catch {
        // Ensure default is within bounds
        return Math.max(min, Math.min(max, def));
    }
};

/**
 * Safe string validation with default fallback
 */
export const safeValidateString = (
    value: unknown, 
    maxLength?: number, 
    def: string = ''
): string => {
    try {
        return validateString(value, maxLength);
    } catch {
        // Truncate default if maxLength specified
        if (maxLength !== undefined && def.length > maxLength) {
            return def.slice(0, maxLength);
        }
        return def;
    }
};

// --- Export Cache Management Utilities ---

/**
 * Clears the schema cache (useful for testing)
 */
export const clearSchemaCache = (): void => {
    SchemaCache.getInstance().clear();
};

/**
 * Gets current cache size
 */
export const getCacheSize = (): number => {
    return SchemaCache.getInstance().size();
};

// --- Type Guards for Runtime Type Safety ---

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

// --- Export Types for Enhanced Type Safety ---
export type {
    SafeFilename,
    SafePath,
    SafeFrontmatterKey,
    BoundedNumber
};
