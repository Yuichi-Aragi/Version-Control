import * as v from 'valibot';

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * Schema for a single note entry in the central manifest.
 */
export const NoteEntrySchema = v.object({
    notePath: v.string(),
    manifestPath: v.string(),
    createdAt: v.pipe(v.string(), v.isoTimestamp()),
    lastModified: v.pipe(v.string(), v.isoTimestamp()),
    // hasEditHistory removed - existence of branch data in IDB/Disk is the source of truth
});

export type NoteEntry = v.InferOutput<typeof NoteEntrySchema>;

/**
 * Schema for the central manifest containing all tracked notes.
 */
export const CentralManifestSchema = v.object({
    version: v.string(),
    notes: v.record(v.string(), NoteEntrySchema),
});

export type CentralManifest = v.InferOutput<typeof CentralManifestSchema>;

/**
 * Schema for editor cursor and scroll position state.
 */
const EditorPositionSchema = v.object({
    line: v.number(),
    ch: v.number(),
});

/**
 * Schema for branch state (editor content and position).
 */
export const BranchStateSchema = v.object({
    content: v.string(),
    cursor: EditorPositionSchema,
    scroll: v.object({
        left: v.number(),
        top: v.number(),
    }),
});

export type BranchState = v.InferOutput<typeof BranchStateSchema>;

// ============================================================================
// SETTINGS SCHEMAS
// ============================================================================

/**
 * Schema for timeline panel settings.
 */
export const TimelineSettingsSchema = v.object({
    showDescription: v.optional(v.boolean(), false),
    showName: v.optional(v.boolean(), true),
    showVersionNumber: v.optional(v.boolean(), true),
    showPreview: v.optional(v.boolean(), true),
    expandByDefault: v.optional(v.boolean(), false),
});

export type TimelineSettings = v.InferOutput<typeof TimelineSettingsSchema>;

/**
 * Schema for history settings (both version and edit history).
 */
export const HistorySettingsSchema = v.object({
    maxVersionsPerNote: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)), 50),
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

    // Persistence Settings
    enableDiskPersistence: v.optional(v.boolean(), true),

    // Auto-registration settings
    autoRegisterNotes: v.optional(v.boolean(), false),
    pathFilters: v.optional(v.array(v.string()), []),
});

export type HistorySettings = v.InferOutput<typeof HistorySettingsSchema>;

/**
 * Schema for global plugin settings.
 */
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

    // Deprecated at top level, but kept for migration/compatibility
    autoRegisterNotes: v.optional(v.boolean(), false),
    pathFilters: v.optional(v.array(v.string()), []),

    // ID Format Settings
    noteIdFormat: v.optional(v.pipe(v.string(), v.minLength(1)), '{uuid}'),
    versionIdFormat: v.optional(v.pipe(v.string(), v.minLength(1)), '{timestamp}_{version}'),

    // Manifests
    centralManifest: v.optional(CentralManifestSchema, { version: '1.0.0', notes: {} }),

    // Split Settings
    versionHistorySettings: HistorySettingsSchema,
    editHistorySettings: HistorySettingsSchema,
});

export type VersionControlSettings = v.InferOutput<typeof VersionControlSettingsSchema>;

// ============================================================================
// MANIFEST SCHEMAS
// ============================================================================

/**
 * Schema for version metadata stored in manifests.
 */
export const VersionMetadataSchema = v.object({
    versionNumber: v.pipe(v.number(), v.integer()),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    size: v.number(),
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

export type VersionMetadata = v.InferOutput<typeof VersionMetadataSchema>;

/**
 * Schema for a branch containing versions and metadata.
 */
export const BranchSchema = v.object({
    versions: v.record(v.string(), VersionMetadataSchema),
    totalVersions: v.pipe(v.number(), v.integer()),
    settings: v.optional(v.partial(HistorySettingsSchema)),
    state: v.optional(BranchStateSchema),
    timelineSettings: v.optional(TimelineSettingsSchema),
});

export type Branch = v.InferOutput<typeof BranchSchema>;

/**
 * Schema for a note manifest containing branches and metadata.
 */
export const NoteManifestSchema = v.object({
    noteId: v.string(),
    notePath: v.string(),
    currentBranch: v.string(),
    branches: v.record(v.string(), BranchSchema),
    createdAt: v.pipe(v.string(), v.isoTimestamp()),
    lastModified: v.pipe(v.string(), v.isoTimestamp()),
});

export type NoteManifest = v.InferOutput<typeof NoteManifestSchema>;

// ============================================================================
// DATA & STATE SCHEMAS
// ============================================================================

/**
 * Schema for a version history entry (for display purposes).
 */
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
    contentHash: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    wordCountWithMd: v.optional(v.number()),
    charCount: v.optional(v.number()),
    charCountWithMd: v.optional(v.number()),
    lineCount: v.optional(v.number()),
    lineCountWithoutMd: v.optional(v.number()),
});

export type VersionHistoryEntry = v.InferOutput<typeof VersionHistoryEntrySchema>;

/**
 * Schema for version data including content.
 */
export const VersionDataSchema = v.object({
    ...VersionHistoryEntrySchema.entries,
    content: v.string(),
});

export type VersionData = v.InferOutput<typeof VersionDataSchema>;

/**
 * Schema for application errors.
 */
export const AppErrorSchema = v.object({
    title: v.string(),
    message: v.string(),
    details: v.optional(v.string()),
});

export type AppError = v.InferOutput<typeof AppErrorSchema>;

// ============================================================================
// DIFF SCHEMAS
// ============================================================================

/**
 * Schema for diff type selection.
 */
export const DiffTypeSchema = v.picklist(['lines', 'words', 'chars', 'smart']);

export type DiffType = v.InferOutput<typeof DiffTypeSchema>;

/**
 * Schema for the "current note state" diff target.
 */
export const DiffTargetCurrentSchema = v.object({
    id: v.literal('current'),
    name: v.literal('Current Note State'),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    notePath: v.string(),
});

/**
 * Schema for a diff target (either a version or current state).
 */
export const DiffTargetSchema = v.union([VersionHistoryEntrySchema, DiffTargetCurrentSchema]);

export type DiffTarget = v.InferOutput<typeof DiffTargetSchema>;

/**
 * Schema for a single change in a diff result.
 */
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

export type Change = v.InferOutput<typeof ChangeSchema>;

/**
 * Schema for a complete diff request/response.
 */
export const DiffRequestSchema = v.object({
    status: v.picklist(['generating', 'ready', 're-diffing']),
    version1: VersionHistoryEntrySchema,
    version2: DiffTargetSchema,
    diffChanges: v.nullable(v.array(ChangeSchema)),
    diffType: DiffTypeSchema,
    content1: v.string(),
    content2: v.string(),
});

export type DiffRequest = v.InferOutput<typeof DiffRequestSchema>;

// ============================================================================
// WORKER-RELATED SCHEMAS (from core files)
// ============================================================================

/**
 * Schema for operation priority levels.
 */
export const OperationPrioritySchema = v.picklist([
    'CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BACKGROUND'
]);

export type OperationPriority = v.InferOutput<typeof OperationPrioritySchema>;

/**
 * Schema for operation metadata.
 */
export const OperationMetadataSchema = v.object({
    id: v.string(),
    timestamp: v.pipe(v.number(), v.integer()),
    priority: OperationPrioritySchema,
    sequence: v.pipe(v.number(), v.integer()),
});

export type OperationMetadata = v.InferOutput<typeof OperationMetadataSchema>;

/**
 * Schema for scheduled write operations.
 */
export const ScheduledWriteSchema = v.object({
    noteId: v.string(),
    branchName: v.string(),
    sequence: v.pipe(v.number(), v.integer()),
    timestamp: v.pipe(v.number(), v.integer()),
    retryCount: v.pipe(v.number(), v.integer()),
});

export type ScheduledWrite = v.InferOutput<typeof ScheduledWriteSchema>;

/**
 * Schema for edit history statistics.
 */
export const EditHistoryStatsSchema = v.object({
    pendingWrites: v.pipe(v.number(), v.integer()),
    queuedOperations: v.pipe(v.number(), v.integer()),
    activeOperations: v.pipe(v.number(), v.integer()),
});

export type EditHistoryStats = v.InferOutput<typeof EditHistoryStatsSchema>;

/**
 * Schema for worker health statistics.
 */
export const WorkerHealthStatsSchema = v.object({
    consecutiveErrors: v.pipe(v.number(), v.integer()),
    operationCount: v.pipe(v.number(), v.integer()),
    averageOperationTime: v.number(),
    isHealthy: v.boolean(),
});

export type WorkerHealthStats = v.InferOutput<typeof WorkerHealthStatsSchema>;

/**
 * Schema for worker status.
 */
export const WorkerStatusSchema = v.object({
    isInitialized: v.boolean(),
    isActive: v.boolean(),
    isHealthy: v.boolean(),
    healthStats: WorkerHealthStatsSchema,
});

export type WorkerStatus = v.InferOutput<typeof WorkerStatusSchema>;

/**
 * Schema for cache statistics.
 */
export const CacheStatsSchema = v.object({
    size: v.pipe(v.number(), v.integer()),
    capacity: v.pipe(v.number(), v.integer()),
    utilization: v.number(),
});

export type CacheStats = v.InferOutput<typeof CacheStatsSchema>;

// ============================================================================
// CLEANUP & RETENTION SCHEMAS
// ============================================================================

/**
 * Schema for retention settings.
 */
export const RetentionSettingsSchema = v.object({
    maxVersionsPerNote: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
    autoCleanupOldVersions: v.boolean(),
    autoCleanupDays: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type RetentionSettings = v.InferOutput<typeof RetentionSettingsSchema>;

/**
 * Schema for cleanup result.
 */
export const CleanupResultSchema = v.object({
    deletedNoteDirs: v.pipe(v.number(), v.integer()),
    deletedVersionFiles: v.pipe(v.number(), v.integer()),
    success: v.boolean(),
    errors: v.optional(v.array(v.string())),
});

export type CleanupResult = v.InferOutput<typeof CleanupResultSchema>;

/**
 * Schema for generic version metadata (compatible with both note and edit manifests).
 */
export const GenericVersionMetadataSchema = v.object({
    versionNumber: v.pipe(v.number(), v.integer()),
    timestamp: v.string(),
});

export type GenericVersionMetadata = v.InferOutput<typeof GenericVersionMetadataSchema>;

// ============================================================================
// TIMELINE SCHEMAS
// ============================================================================

/**
 * Schema for timeline statistics.
 */
export const TimelineStatsSchema = v.object({
    additions: v.pipe(v.number(), v.integer()),
    deletions: v.pipe(v.number(), v.integer()),
});

export type TimelineStats = v.InferOutput<typeof TimelineStatsSchema>;

/**
 * Schema for a timeline event.
 */
export const TimelineEventSchema = v.object({
    id: v.optional(v.pipe(v.number(), v.integer())),
    noteId: v.string(),
    branchName: v.string(),
    source: v.picklist(['version', 'edit']),
    fromVersionId: v.nullable(v.string()),
    toVersionId: v.string(),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    diffData: v.array(ChangeSchema),
    stats: TimelineStatsSchema,
    toVersionName: v.optional(v.string()),
    toVersionNumber: v.pipe(v.number(), v.integer()),
    toVersionDescription: v.optional(v.string()),
});

export type TimelineEvent = v.InferOutput<typeof TimelineEventSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates data against a schema and returns the result.
 * @param schema The valibot schema to validate against
 * @param data The data to validate
 * @returns Object with success flag and either output or issues
 */
export function validateSchema<TOutput, TInput extends TOutput>(
    schema: v.BaseSchema<TOutput, TInput, v.BaseIssue<unknown>>,
    data: TInput
): { success: true; output: TOutput } | { success: false; issues: v.BaseIssue<unknown>[] } {
    const result = v.safeParse(schema, data);
    if (result.success) {
        return { success: true, output: result.output };
    }
    return { success: false, issues: result.issues };
}

/**
 * Parses and validates data against a schema, throwing on error.
 * @param schema The valibot schema to validate against
 * @param data The data to validate
 * @returns The validated output
 * @throws Error with validation issues if validation fails
 */
export function parseSchema<TOutput, TInput extends TOutput>(
    schema: v.BaseSchema<TOutput, TInput, v.BaseIssue<unknown>>,
    data: TInput
): TOutput {
    const result = v.parse(schema, data);
    return result;
}
