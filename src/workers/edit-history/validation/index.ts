import * as v from 'valibot';
import { freeze } from 'immer';
import { ValidationError } from '@/workers/edit-history/errors';
import {
    NoteIdSchema,
    OldNoteIdSchema,
    NewNoteIdSchema,
    BranchNameSchema,
    EditIdSchema,
    PathSchema,
    ContentSchema,
    ManifestSchema
} from './schemas';
import type { NoteManifest } from '@/types';

export * from './schemas';

// ============================================================================
// CORE VALIDATION LOGIC
// ============================================================================

export function validateInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    try {
        const result = v.safeParse(schema, input);
        
        if (!result.success) {
            const issues = result.issues;
            const messages = issues.map(issue => 
                `${fieldName}: ${issue.message} at ${issue.path?.map(p => p.key).join('.') || 'root'}`
            );
            
            throw new ValidationError(
                messages.join(', '),
                fieldName,
                freeze(issues, true)
            );
        }
        
        return result.output;
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        
        throw new ValidationError(
            `Validation failed for ${fieldName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            fieldName
        );
    }
}

export function validatePartialInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): Partial<v.InferOutput<TSchema>> {
    try {
        const result = v.safeParse(schema, input);
        
        if (!result.success) {
            const issues = result.issues.filter(issue => 
                issue.message !== 'Invalid type' && issue.message !== 'Required'
            );
            
            if (issues.length > 0) {
                const messages = issues.map(issue => 
                    `${fieldName}: ${issue.message} at ${issue.path?.map(p => p.key).join('.') || 'root'}`
                );
                
                throw new ValidationError(
                    messages.join(', '),
                    fieldName,
                    freeze(issues, true)
                );
            }
            
            return input as Partial<v.InferOutput<TSchema>>;
        }
        
        return result.output;
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        
        throw new ValidationError(
            `Partial validation failed for ${fieldName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            fieldName
        );
    }
}

export function sanitizeInput(input: unknown): unknown {
    if (typeof input === 'string') {
        return input
            .replace(/\0/g, '')
            .replace(/[^\x20-\x7E\t\r\n]/g, '')
            .trim();
    }
    
    if (Array.isArray(input)) {
        return input.map(sanitizeInput);
    }
    
    if (input && typeof input === 'object') {
        return Object.fromEntries(
            Object.entries(input).map(([key, value]) => [key, sanitizeInput(value)])
        );
    }
    
    return input;
}

export function validateAndSanitizeInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    const sanitized = sanitizeInput(input);
    return validateInput(schema, sanitized, fieldName);
}

// ============================================================================
// CENTRALIZED DOMAIN VALIDATORS
// ============================================================================

/**
 * Validates a standard Note ID.
 */
export function validateNoteId(input: unknown): string {
    return validateInput(NoteIdSchema, input, 'noteId');
}

/**
 * Validates an Old Note ID (source of a rename).
 */
export function validateOldNoteId(input: unknown): string {
    return validateInput(OldNoteIdSchema, input, 'oldNoteId');
}

/**
 * Validates a New Note ID (target of a rename).
 */
export function validateNewNoteId(input: unknown): string {
    return validateInput(NewNoteIdSchema, input, 'newNoteId');
}

/**
 * Validates a Branch Name.
 */
export function validateBranchName(input: unknown): string {
    return validateInput(BranchNameSchema, input, 'branchName');
}

/**
 * Validates an Edit ID.
 */
export function validateEditId(input: unknown, fieldName: string = 'editId'): string {
    return validateInput(EditIdSchema, input, fieldName);
}

/**
 * Validates a File Path.
 */
export function validatePath(input: unknown, fieldName: string = 'path'): string {
    return validateInput(PathSchema, input, fieldName);
}

/**
 * Validates Content (String or ArrayBuffer).
 */
export function validateContent(input: unknown): string | ArrayBuffer {
    return validateInput(ContentSchema, input, 'content');
}

/**
 * Validates a Note Manifest.
 */
export function validateNoteManifest(input: unknown): NoteManifest {
    return validateInput(ManifestSchema, input, 'manifest') as NoteManifest;
}

/**
 * Validates an ArrayBuffer (e.g., zip data).
 */
export function validateArrayBuffer(input: unknown, fieldName: string): ArrayBuffer {
    if (!(input instanceof ArrayBuffer)) {
        throw new ValidationError(`${fieldName} must be an ArrayBuffer`, fieldName);
    }
    
    if (input.byteLength === 0) {
        throw new ValidationError(`${fieldName} must not be empty`, fieldName);
    }
    
    return input;
}
