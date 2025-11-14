import { z } from 'zod';

// --- Base Schemas ---

export const NoteEntrySchema = z.object({
    notePath: z.string(),
    manifestPath: z.string(),
    createdAt: z.string().datetime(),
    lastModified: z.string().datetime(),
});

export const CentralManifestSchema = z.object({
    version: z.string(),
    notes: z.record(z.string(), NoteEntrySchema),
});

const EditorPositionSchema = z.object({
    line: z.number(),
    ch: z.number(),
});

export const BranchStateSchema = z.object({
    content: z.string(),
    cursor: EditorPositionSchema,
    scroll: z.object({
        left: z.number(),
        top: z.number(),
    }),
});

// --- Settings Schema ---

export const VersionControlSettingsSchema = z.object({
    version: z.string().optional().default('0.0.0'),
    databasePath: z.string().min(1),
    noteIdFrontmatterKey: z.string().min(1).refine(s => !s.includes(':'), { message: "Key cannot contain a colon" }),
    keyUpdatePathFilters: z.array(z.string()).optional().default([]),
    maxVersionsPerNote: z.number().int().min(0).optional().default(50),
    autoCleanupOldVersions: z.boolean().optional().default(false),
    autoCleanupDays: z.number().int().min(1).optional().default(60),
    defaultExportFormat: z.enum(['md', 'json', 'ndjson', 'txt']).optional().default('md'),
    useRelativeTimestamps: z.boolean().optional().default(true),
    enableVersionNaming: z.boolean().optional().default(true),
    enableVersionDescription: z.boolean().optional().default(false),
    isListView: z.boolean().optional().default(false),
    renderMarkdownInPreview: z.boolean().optional().default(true),
    enableWatchMode: z.boolean().optional().default(false),
    watchModeInterval: z.number().int().min(1).optional().default(60),
    autoSaveOnSave: z.boolean().optional().default(false),
    autoSaveOnSaveInterval: z.number().int().min(1).optional().default(2),
    enableMinLinesChangedCheck: z.boolean().optional().default(false),
    minLinesChanged: z.number().int().min(1).optional().default(5),
    autoRegisterNotes: z.boolean().optional().default(false),
    pathFilters: z.array(z.string()).optional().default([]),
    centralManifest: CentralManifestSchema.optional().default({ version: "1.0.0", notes: {} }),
    isGlobal: z.boolean().optional(),
    enableWordCount: z.boolean().optional().default(false),
    includeMdSyntaxInWordCount: z.boolean().optional().default(false),
    enableCharacterCount: z.boolean().optional().default(false),
    includeMdSyntaxInCharacterCount: z.boolean().optional().default(false),
    enableLineCount: z.boolean().optional().default(false),
    includeMdSyntaxInLineCount: z.boolean().optional().default(false),
});

const PartialNoteSettingsSchema = VersionControlSettingsSchema.omit({
    databasePath: true,
    centralManifest: true,
    autoRegisterNotes: true,
    pathFilters: true,
    noteIdFrontmatterKey: true,
    keyUpdatePathFilters: true,
    version: true,
}).partial();

// --- Manifest Schemas ---

export const BranchSchema = z.object({
    versions: z.record(z.string(), z.object({
        versionNumber: z.number().int(),
        timestamp: z.string().datetime(),
        name: z.string().optional(),
        description: z.string().optional(),
        size: z.number(),
        wordCount: z.number().optional(),
        wordCountWithMd: z.number().optional(),
        charCount: z.number().optional(),
        charCountWithMd: z.number().optional(),
        lineCount: z.number().optional(),
        lineCountWithoutMd: z.number().optional(),
    })),
    totalVersions: z.number().int(),
    settings: PartialNoteSettingsSchema.optional(),
    state: BranchStateSchema.optional(),
});

export const NoteManifestSchema = z.object({
    noteId: z.string(),
    notePath: z.string(),
    currentBranch: z.string(),
    branches: z.record(z.string(), BranchSchema),
    createdAt: z.string().datetime(),
    lastModified: z.string().datetime(),
});

// --- Data & State Schemas ---

export const VersionHistoryEntrySchema = z.object({
    id: z.string(),
    noteId: z.string(),
    notePath: z.string(),
    branchName: z.string(),
    versionNumber: z.number(),
    timestamp: z.string().datetime(),
    name: z.string().optional(),
    description: z.string().optional(),
    size: z.number(),
    wordCount: z.number().optional(),
    wordCountWithMd: z.number().optional(),
    charCount: z.number().optional(),
    charCountWithMd: z.number().optional(),
    lineCount: z.number().optional(),
    lineCountWithoutMd: z.number().optional(),
});

export const VersionDataSchema = VersionHistoryEntrySchema.extend({
    content: z.string(),
});

export const AppErrorSchema = z.object({
    title: z.string(),
    message: z.string(),
    details: z.string().optional(),
});

// --- Diff-related Schemas ---

export const DiffTypeSchema = z.enum(['lines', 'words', 'chars', 'json']);

export const DiffTargetCurrentSchema = z.object({
    id: z.literal('current'),
    name: z.literal('Current Note State'),
    timestamp: z.string().datetime(),
    notePath: z.string(),
});

export const DiffTargetSchema = z.union([VersionHistoryEntrySchema, DiffTargetCurrentSchema]);

export const ChangeSchema = z.object({
    value: z.string(),
    added: z.boolean(),
    removed: z.boolean(),
    count: z.number(),
});

export const DiffRequestSchema = z.object({
    status: z.enum(['generating', 'ready', 're-diffing']),
    version1: VersionHistoryEntrySchema,
    version2: DiffTargetSchema,
    diffChanges: z.array(ChangeSchema).nullable(),
    diffType: DiffTypeSchema,
    content1: z.string(),
    content2: z.string(),
});
