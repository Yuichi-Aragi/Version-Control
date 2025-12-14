import * as v from 'valibot';
import { CONFIG } from '@/workers/edit-history/config';

export const NoteIdSchema = v.pipe(
    v.string('noteId must be a string'),
    v.nonEmpty('noteId cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `noteId cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

export const BranchNameSchema = v.pipe(
    v.string('branchName must be a string'),
    v.nonEmpty('branchName cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `branchName cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

export const EditIdSchema = v.pipe(
    v.string('editId must be a string'),
    v.nonEmpty('editId cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `editId cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

export const PathSchema = v.pipe(
    v.string('path must be a string'),
    v.transform((s: string): string => s.trim())
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

export const VersionInfoSchema = v.object({
    versionNumber: v.number(),
    timestamp: v.string(),
    size: v.number(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    compressedSize: v.optional(v.number()),
    uncompressedSize: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    wordCountWithMd: v.optional(v.number()),
    charCount: v.optional(v.number()),
    charCountWithMd: v.optional(v.number()),
    lineCount: v.optional(v.number()),
    lineCountWithoutMd: v.optional(v.number()),
});

export const TimelineSettingsSchema = v.object({
    showDescription: v.boolean(),
    showName: v.boolean(),
    showVersionNumber: v.boolean(),
    expandByDefault: v.boolean(),
});

export const BranchInfoSchema = v.object({
    versions: v.record(v.string(), VersionInfoSchema),
    totalVersions: v.number(),
    settings: v.optional(v.record(v.string(), v.unknown())),
    state: v.optional(v.object({
        content: v.string(),
        cursor: v.object({ line: v.number(), ch: v.number() }),
        scroll: v.object({ left: v.number(), top: v.number() }),
    })),
    timelineSettings: v.optional(TimelineSettingsSchema),
});

export const ManifestSchema = v.object({
    noteId: v.pipe(v.string(), v.nonEmpty()),
    notePath: v.string(),
    currentBranch: v.string(),
    branches: v.record(v.string(), BranchInfoSchema),
    createdAt: v.string(),
    lastModified: v.string()
});
