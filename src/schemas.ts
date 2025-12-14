import * as v from 'valibot';

// --- Base Schemas ---

export const NoteEntrySchema = v.object({
    notePath: v.string(),
    manifestPath: v.string(),
    createdAt: v.pipe(v.string(), v.isoTimestamp()),
    lastModified: v.pipe(v.string(), v.isoTimestamp()),
    hasEditHistory: v.optional(v.boolean(), false),
});

export const CentralManifestSchema = v.object({
    version: v.string(),
    notes: v.record(v.string(), NoteEntrySchema),
});

const EditorPositionSchema = v.object({
    line: v.number(),
    ch: v.number(),
});

export const BranchStateSchema = v.object({
    content: v.string(),
    cursor: EditorPositionSchema,
    scroll: v.object({
        left: v.number(),
        top: v.number(),
    }),
});

// --- Timeline Settings Schema ---

export const TimelineSettingsSchema = v.object({
    showDescription: v.optional(v.boolean(), false),
    showName: v.optional(v.boolean(), true),
    showVersionNumber: v.optional(v.boolean(), true),
    expandByDefault: v.optional(v.boolean(), false),
});

// --- History Settings Schema (Replaces flat settings) ---

export const HistorySettingsSchema = v.object({
    maxVersionsPerNote: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 50),
    autoCleanupOldVersions: v.optional(v.boolean(), false),
    autoCleanupDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 60),
    useRelativeTimestamps: v.optional(v.boolean(), true),
    enableVersionNaming: v.optional(v.boolean(), true),
    enableVersionDescription: v.optional(v.boolean(), false),
    showDescriptionInList: v.optional(v.boolean(), false),
    isListView: v.optional(v.boolean(), false),
    renderMarkdownInPreview: v.optional(v.boolean(), true),
    enableWatchMode: v.optional(v.boolean(), false),
    watchModeInterval: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 60),
    autoSaveOnSave: v.optional(v.boolean(), false),
    autoSaveOnSaveInterval: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 2),
    enableMinLinesChangedCheck: v.optional(v.boolean(), false),
    minLinesChanged: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 5),
    enableWordCount: v.optional(v.boolean(), false),
    includeMdSyntaxInWordCount: v.optional(v.boolean(), false),
    enableCharacterCount: v.optional(v.boolean(), false),
    includeMdSyntaxInCharacterCount: v.optional(v.boolean(), false),
    enableLineCount: v.optional(v.boolean(), false),
    includeMdSyntaxInLineCount: v.optional(v.boolean(), false),
    isGlobal: v.optional(v.boolean(), true),

    // Auto-registration settings (moved/duplicated from global)
    autoRegisterNotes: v.optional(v.boolean(), false),
    pathFilters: v.optional(v.array(v.string()), []),
});

// --- Global Settings Schema ---

export const VersionControlSettingsSchema = v.object({
    version: v.optional(v.string(), '0.0.0'),
    databasePath: v.pipe(v.string(), v.minLength(1)),
    noteIdFrontmatterKey: v.pipe(
        v.string(),
        v.minLength(1),
        v.check((s) => !s.includes(':'), 'Key cannot contain a colon')
    ),
    legacyNoteIdFrontmatterKeys: v.optional(v.array(v.string()), []),
    keyUpdatePathFilters: v.optional(v.array(v.string()), []),
    defaultExportFormat: v.optional(v.picklist(['md', 'json', 'ndjson', 'txt', 'zip', 'gzip']), 'md'),
    enableCompression: v.optional(v.boolean(), true),

    // Deprecated at top level, but kept for migration/compatibility if needed
    autoRegisterNotes: v.optional(v.boolean(), false),
    pathFilters: v.optional(v.array(v.string()), []),

    // ID Format Settings
    noteIdFormat: v.optional(v.pipe(v.string(), v.minLength(1)), '{uuid}'),
    versionIdFormat: v.optional(v.pipe(v.string(), v.minLength(1)), '{timestamp}_{version}'),

    // Manifests
    centralManifest: v.optional(CentralManifestSchema, { version: '1.0.0', notes: {} }),
    // editHistoryManifest removed - merged into centralManifest

    // Split Settings
    versionHistorySettings: HistorySettingsSchema,
    editHistorySettings: HistorySettingsSchema,
});

// --- Manifest Schemas ---

const VersionMetadataSchema = v.object({
    versionNumber: v.pipe(v.number(), v.integer()),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    size: v.number(),
    compressedSize: v.optional(v.number()),
    uncompressedSize: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    wordCountWithMd: v.optional(v.number()),
    charCount: v.optional(v.number()),
    charCountWithMd: v.optional(v.number()),
    lineCount: v.optional(v.number()),
    lineCountWithoutMd: v.optional(v.number()),
});

export const BranchSchema = v.object({
    versions: v.record(v.string(), VersionMetadataSchema),
    totalVersions: v.pipe(v.number(), v.integer()),
    settings: v.optional(v.partial(HistorySettingsSchema)),
    state: v.optional(BranchStateSchema),
    timelineSettings: v.optional(TimelineSettingsSchema),
});

export const NoteManifestSchema = v.object({
    noteId: v.string(),
    notePath: v.string(),
    currentBranch: v.string(),
    branches: v.record(v.string(), BranchSchema),
    createdAt: v.pipe(v.string(), v.isoTimestamp()),
    lastModified: v.pipe(v.string(), v.isoTimestamp()),
    // viewMode removed to prevent persistence
});

// --- Data & State Schemas ---

export const VersionHistoryEntrySchema = v.object({
    id: v.string(),
    noteId: v.string(),
    notePath: v.string(),
    branchName: v.string(),
    versionNumber: v.number(),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    size: v.number(),
    compressedSize: v.optional(v.number()),
    uncompressedSize: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    wordCountWithMd: v.optional(v.number()),
    charCount: v.optional(v.number()),
    charCountWithMd: v.optional(v.number()),
    lineCount: v.optional(v.number()),
    lineCountWithoutMd: v.optional(v.number()),
});

export const VersionDataSchema = v.object({
    ...VersionHistoryEntrySchema.entries,
    content: v.string(),
});

export const AppErrorSchema = v.object({
    title: v.string(),
    message: v.string(),
    details: v.optional(v.string()),
});

// --- Diff-related Schemas ---

export const DiffTypeSchema = v.picklist(['lines', 'words', 'chars', 'smart']);

export const DiffTargetCurrentSchema = v.object({
    id: v.literal('current'),
    name: v.literal('Current Note State'),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    notePath: v.string(),
});

export const DiffTargetSchema = v.union([VersionHistoryEntrySchema, DiffTargetCurrentSchema]);

export const ChangeSchema = v.object({
    value: v.string(),
    added: v.optional(v.boolean()),
    removed: v.optional(v.boolean()),
    count: v.optional(v.number()),
    parts: v.optional(
        v.array(
            v.object({
                value: v.string(),
                added: v.optional(v.boolean()),
                removed: v.optional(v.boolean()),
                count: v.optional(v.number()),
            })
        )
    ),
});

export const DiffRequestSchema = v.object({
    status: v.picklist(['generating', 'ready', 're-diffing']),
    version1: VersionHistoryEntrySchema,
    version2: DiffTargetSchema,
    diffChanges: v.nullable(v.array(ChangeSchema)),
    diffType: DiffTypeSchema,
    content1: v.string(),
    content2: v.string(),
});
