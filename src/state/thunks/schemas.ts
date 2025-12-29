import * as v from 'valibot';
import { VersionControlSettingsSchema } from '@/schemas';

/**
 * Validation schemas for Thunk payloads.
 * Enforces strict type safety at the boundary of the state management layer.
 */

// --- Version Thunk Schemas ---

export const SaveVersionOptionsSchema = v.object({
    name: v.optional(v.string()),
    force: v.optional(v.boolean()),
    isAuto: v.optional(v.boolean()),
    settings: v.optional(VersionControlSettingsSchema),
});

export const UpdateVersionDetailsPayloadSchema = v.object({
    name: v.pipe(v.string(), v.trim()),
    description: v.pipe(v.string(), v.trim()),
});

// --- Edit History Thunk Schemas ---

export const EditDetailsSchema = v.object({
    name: v.pipe(v.string(), v.trim()),
    description: v.pipe(v.string(), v.trim()),
});

// --- Core Thunk Schemas ---

export const NoteIdSchema = v.pipe(v.string(), v.minLength(1));

export const FilePathSchema = v.pipe(v.string(), v.minLength(1));

// --- Settings Thunk Schemas ---

export const KeyUpdateSchema = v.pipe(v.string(), v.trim(), v.minLength(1));

export const DatabasePathSchema = v.pipe(v.string(), v.trim(), v.minLength(1));

export const IdFormatSchema = v.pipe(v.string(), v.minLength(1));
