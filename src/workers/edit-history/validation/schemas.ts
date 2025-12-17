import * as v from 'valibot';
import { CONFIG } from '@/workers/edit-history/config';

// ============================================================================
// BASE ID SCHEMA
// ============================================================================

const BaseIdSchema = v.pipe(
    v.string('id must be a string'),
    v.nonEmpty('id cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `id cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim())
);

// ============================================================================
// DOMAIN SPECIFIC ID SCHEMAS
// ============================================================================

export const NoteIdSchema = BaseIdSchema;
// Explicit schemas for rename operations to allow for future divergence or specific rules
export const OldNoteIdSchema = BaseIdSchema;
export const NewNoteIdSchema = BaseIdSchema;

export const BranchNameSchema = BaseIdSchema;
export const EditIdSchema = BaseIdSchema;

// ============================================================================
// CONTENT & PATH SCHEMAS
// ============================================================================

export const PathSchema = v.pipe(
    v.string('path must be a string'),
    v.maxLength(4096, 'path cannot exceed 4096 characters'),
    v.transform((s: string): string => s.trim().replace(/[\\\/]{2,}/g, '/'))
);

export const StringContentSchema = v.pipe(
    v.string('content must be a string'),
    v.maxLength(CONFIG.MAX_CONTENT_SIZE, `content cannot exceed ${CONFIG.MAX_CONTENT_SIZE} bytes`)
);

export const ArrayBufferContentSchema = v.pipe(
    v.instance(ArrayBuffer, 'content must be an ArrayBuffer'),
    v.check(
        (b: ArrayBuffer): boolean => b.byteLength <= CONFIG.MAX_CONTENT_SIZE,
        `content cannot exceed ${CONFIG.MAX_CONTENT_SIZE} bytes`
    )
);

export const ContentSchema = v.union([StringContentSchema, ArrayBufferContentSchema]);

// ============================================================================
// METADATA SCHEMAS
// ============================================================================

export const VersionInfoSchema = v.object({
    versionNumber: v.number('versionNumber must be a number'),
    timestamp: v.pipe(
        v.string('timestamp must be a string'),
        v.isoTimestamp('timestamp must be a valid ISO timestamp')
    ),
    size: v.pipe(
        v.number('size must be a number'),
        v.minValue(0, 'size cannot be negative')
    ),
    name: v.optional(
        v.pipe(
            v.string('name must be a string'),
            v.maxLength(200, 'name cannot exceed 200 characters')
        )
    ),
    description: v.optional(
        v.pipe(
            v.string('description must be a string'),
            v.maxLength(1000, 'description cannot exceed 1000 characters')
        )
    ),
    compressedSize: v.optional(
        v.pipe(
            v.number('compressedSize must be a number'),
            v.minValue(0, 'compressedSize cannot be negative')
        )
    ),
    uncompressedSize: v.optional(
        v.pipe(
            v.number('uncompressedSize must be a number'),
            v.minValue(0, 'uncompressedSize cannot be negative')
        )
    ),
    contentHash: v.optional(
        v.pipe(
            v.string('contentHash must be a string'),
            v.regex(/^[a-f0-9]{64}$|^$/, 'contentHash must be a 64-character hex string or empty')
        )
    ),
    wordCount: v.optional(
        v.pipe(
            v.number('wordCount must be a number'),
            v.minValue(0, 'wordCount cannot be negative')
        )
    ),
    wordCountWithMd: v.optional(
        v.pipe(
            v.number('wordCountWithMd must be a number'),
            v.minValue(0, 'wordCountWithMd cannot be negative')
        )
    ),
    charCount: v.optional(
        v.pipe(
            v.number('charCount must be a number'),
            v.minValue(0, 'charCount cannot be negative')
        )
    ),
    charCountWithMd: v.optional(
        v.pipe(
            v.number('charCountWithMd must be a number'),
            v.minValue(0, 'charCountWithMd cannot be negative')
        )
    ),
    lineCount: v.optional(
        v.pipe(
            v.number('lineCount must be a number'),
            v.minValue(0, 'lineCount cannot be negative')
        )
    ),
    lineCountWithoutMd: v.optional(
        v.pipe(
            v.number('lineCountWithoutMd must be a number'),
            v.minValue(0, 'lineCountWithoutMd cannot be negative')
        )
    ),
});

export const TimelineSettingsSchema = v.object({
    showDescription: v.boolean('showDescription must be a boolean'),
    showName: v.boolean('showName must be a boolean'),
    showVersionNumber: v.boolean('showVersionNumber must be a boolean'),
    expandByDefault: v.boolean('expandByDefault must be a boolean'),
});

export const BranchInfoSchema = v.object({
    versions: v.record(
        EditIdSchema,
        VersionInfoSchema,
        'versions must be a record of edit IDs to version info'
    ),
    totalVersions: v.pipe(
        v.number('totalVersions must be a number'),
        v.minValue(0, 'totalVersions cannot be negative')
    ),
    settings: v.optional(v.record(v.string(), v.any())),
    state: v.optional(v.object({
        content: v.string('content must be a string'),
        cursor: v.object({
            line: v.number('line must be a number'),
            ch: v.number('ch must be a number')
        }),
        scroll: v.object({
            left: v.number('left must be a number'),
            top: v.number('top must be a number')
        }),
    })),
    timelineSettings: v.optional(TimelineSettingsSchema),
});

export const ManifestSchema = v.object({
    noteId: NoteIdSchema,
    notePath: PathSchema,
    currentBranch: BranchNameSchema,
    branches: v.record(
        BranchNameSchema,
        BranchInfoSchema,
        'branches must be a record of branch names to branch info'
    ),
    createdAt: v.pipe(
        v.string('createdAt must be a string'),
        v.isoTimestamp('createdAt must be a valid ISO timestamp')
    ),
    lastModified: v.pipe(
        v.string('lastModified must be a string'),
        v.isoTimestamp('lastModified must be a valid ISO timestamp')
    )
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ValidatedNoteId = v.InferOutput<typeof NoteIdSchema>;
export type ValidatedBranchName = v.InferOutput<typeof BranchNameSchema>;
export type ValidatedEditId = v.InferOutput<typeof EditIdSchema>;
export type ValidatedPath = v.InferOutput<typeof PathSchema>;
export type ValidatedContent = v.InferOutput<typeof ContentSchema>;
export type ValidatedManifest = v.InferOutput<typeof ManifestSchema>;
