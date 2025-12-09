/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { Dexie, type Table } from 'dexie';
import { createPatch, applyPatch } from 'diff';
import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate';
import { produce, freeze, enableMapSet } from 'immer';
import * as v from 'valibot';
import { isEqual, sortBy } from 'es-toolkit';
import type { NoteManifest } from '../types';

// Enable immer Map/Set support for immutable collections
enableMapSet();

// --- Constants & Configuration (Frozen) ---
const CONFIG = freeze({
    MAX_CHAIN_LENGTH: 50,
    DIFF_SIZE_THRESHOLD: 0.8,
    DB_NAME: 'VersionControlEditHistoryDB',
    COMPRESSION_LEVEL: 9,
    MAX_CONTENT_SIZE: 50 * 1024 * 1024,
    MAX_ID_LENGTH: 255,
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY_MS: 10,
    HASH_ALGORITHM: 'SHA-256'
} as const);

// --- Valibot Schemas (Type-Safe Validation) ---
const NoteIdSchema = v.pipe(
    v.string('noteId must be a string'),
    v.nonEmpty('noteId cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `noteId cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

const BranchNameSchema = v.pipe(
    v.string('branchName must be a string'),
    v.nonEmpty('branchName cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `branchName cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

const EditIdSchema = v.pipe(
    v.string('editId must be a string'),
    v.nonEmpty('editId cannot be empty'),
    v.maxLength(CONFIG.MAX_ID_LENGTH, `editId cannot exceed ${CONFIG.MAX_ID_LENGTH} characters`),
    v.transform((s: string): string => s.trim().replace(/\0/g, ''))
);

const PathSchema = v.pipe(
    v.string('path must be a string'),
    v.transform((s: string): string => s.trim())
);

const StringContentSchema = v.pipe(
    v.string('content must be a string'),
    v.maxLength(CONFIG.MAX_CONTENT_SIZE, `content cannot exceed ${CONFIG.MAX_CONTENT_SIZE} bytes`)
);

const ArrayBufferContentSchema = v.pipe(
    v.instance(ArrayBuffer, 'content must be an ArrayBuffer'),
    v.check(
        (b: ArrayBuffer): boolean => b.byteLength <= CONFIG.MAX_CONTENT_SIZE,
        `content cannot exceed ${CONFIG.MAX_CONTENT_SIZE} bytes`
    )
);

const ContentSchema = v.union([StringContentSchema, ArrayBufferContentSchema]);

const VersionInfoSchema = v.object({
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

const TimelineSettingsSchema = v.object({
    showDescription: v.boolean(),
    showName: v.boolean(),
    showVersionNumber: v.boolean(),
    expandByDefault: v.boolean(),
});

const BranchInfoSchema = v.object({
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

const ManifestSchema = v.object({
    noteId: v.pipe(v.string(), v.nonEmpty()),
    notePath: v.string(),
    currentBranch: v.string(),
    branches: v.record(v.string(), BranchInfoSchema),
    createdAt: v.string(),
    lastModified: v.string()
});

// --- Types & Interfaces (Immutable by convention) ---
type StorageType = 'full' | 'diff';

interface StoredEdit {
    id?: number;
    noteId: string;
    branchName: string;
    editId: string;
    content: ArrayBuffer;
    contentHash: string;
    storageType: StorageType;
    baseEditId?: string;
    previousEditId?: string;
    chainLength: number;
    createdAt: number;
    size: number;
    uncompressedSize: number;
}

interface StoredManifest {
    readonly noteId: string;
    readonly manifest: NoteManifest;
    readonly updatedAt: number;
}

interface ReconstructionResult {
    readonly content: string;
    readonly hash: string;
    readonly verified: boolean;
}

interface PreviousEditContext {
    readonly editId: string;
    readonly content: string;
    readonly contentHash: string;
    readonly baseEditId: string;
    readonly chainLength: number;
}

interface DatabaseStats {
    readonly editCount: number;
    readonly manifestCount: number;
    readonly activeKeys: readonly string[];
}

interface IntegrityCheckResult {
    readonly valid: boolean;
    readonly expectedHash: string;
    readonly actualHash: string;
}

// --- Custom Error Classes (Immutable) ---
class ValidationError extends Error {
    readonly field: string | undefined;
    readonly issues: readonly v.BaseIssue<unknown>[] | undefined;

    constructor(message: string, field?: string, issues?: readonly v.BaseIssue<unknown>[]) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.issues = issues ? freeze([...issues]) : undefined;
        Object.freeze(this);
    }
}

class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecurityError';
        Object.freeze(this);
    }
}

class StateConsistencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StateConsistencyError';
        Object.freeze(this);
    }
}

class IntegrityError extends Error {
    readonly expectedHash: string;
    readonly actualHash: string;

    constructor(message: string, expectedHash: string, actualHash: string) {
        super(message);
        this.name = 'IntegrityError';
        this.expectedHash = expectedHash;
        this.actualHash = actualHash;
        Object.freeze(this);
    }
}

// --- Validation Utilities ---
function validateInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (!result.success) {
        const messages = result.issues.map((i) => i.message).join('; ');
        throw new ValidationError(`Invalid ${fieldName}: ${messages}`, fieldName, result.issues);
    }
    return result.output;
}

// --- Hash Service (Cryptographic Integrity) ---
class HashService {
    private static readonly encoder = new TextEncoder();

    static async computeHash(content: string): Promise<string> {
        const data = this.encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest(CONFIG.HASH_ALGORITHM, data);
        const hashArray = new Uint8Array(hashBuffer);
        let hex = '';
        for (let i = 0; i < hashArray.length; i++) {
            hex += hashArray[i]!.toString(16).padStart(2, '0');
        }
        return hex;
    }

    static async verifyIntegrity(content: string, expectedHash: string): Promise<boolean> {
        if (!expectedHash || expectedHash.length === 0) {
            return true;
        }
        const actualHash = await this.computeHash(content);
        return actualHash === expectedHash;
    }
}

// --- Database (Dexie with Migrations) ---
class EditHistoryDB extends Dexie {
    edits!: Table<StoredEdit, number>;
    manifests!: Table<StoredManifest, string>;

    constructor() {
        super(CONFIG.DB_NAME);
        this.configureDatabase();
    }

    private configureDatabase(): void {
        this.version(1).stores({
            edits: '++id, [noteId+editId], noteId',
            manifests: 'noteId'
        });

        this.version(2).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt',
            manifests: 'noteId, updatedAt'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                if (!edit.branchName) edit.branchName = 'main';
                if (!edit.createdAt) edit.createdAt = Date.now();
                if (!edit.storageType) edit.storageType = 'full';
                if (edit.chainLength === undefined) edit.chainLength = 0;
                if (!edit.size) edit.size = edit.content?.byteLength ?? 0;
            });
        });

        this.version(3).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });

        this.version(4).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });

        this.version(5).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, contentHash, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        }).upgrade((tx) => {
            return tx.table('edits').toCollection().modify((edit) => {
                if (edit.contentHash === undefined) edit.contentHash = '';
                if (edit.uncompressedSize === undefined) edit.uncompressedSize = 0;
            });
        });
    }
}

const db = new EditHistoryDB();

// --- Compression Service ---
class CompressionService {
    static readonly textEncoder = new TextEncoder();
    static readonly textDecoder = new TextDecoder('utf-8');

    static compressContent(content: string): ArrayBuffer {
        if (content.length === 0) {
            return new ArrayBuffer(0);
        }
        try {
            const data = strToU8(content);
            const compressed = compressSync(data, { level: CONFIG.COMPRESSION_LEVEL });
            return compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            ) as ArrayBuffer;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown compression error';
            throw new SecurityError(`Compression failed: ${message}`);
        }
    }

    static decompressContent(buffer: ArrayBuffer): string {
        if (buffer.byteLength === 0) {
            return '';
        }
        try {
            const compressed = new Uint8Array(buffer);
            const decompressed = decompressSync(compressed);
            return strFromU8(decompressed);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown decompression error';
            throw new SecurityError(`Decompression failed: ${message}`);
        }
    }

    static async decompressLegacy(buffer: ArrayBuffer): Promise<string> {
        if (buffer.byteLength === 0) {
            return '';
        }
        try {
            const stream = new Blob([buffer]).stream();
            const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
            const resultBuffer = await new Response(decompressed).arrayBuffer();
            return this.textDecoder.decode(resultBuffer);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown legacy decompression error';
            throw new SecurityError(`Legacy decompression failed: ${message}`);
        }
    }

    static async decompress(record: StoredEdit): Promise<string> {
        if (!record.storageType) {
            return Dexie.waitFor(this.decompressLegacy(record.content));
        }
        return this.decompressContent(record.content);
    }

    static getUncompressedSize(content: string): number {
        return strToU8(content).length;
    }
}

// --- Diff Service ---
class DiffService {
    static createDiff(oldContent: string, newContent: string, editId: string): string {
        try {
            return createPatch(`edit_${editId}`, oldContent, newContent, '', '', { context: 3 });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown diff creation error';
            throw new StateConsistencyError(`Diff creation failed: ${message}`);
        }
    }

    static applyDiff(baseContent: string, patch: string): string {
        try {
            const result = applyPatch(baseContent, patch);
            if (result === false) {
                throw new StateConsistencyError('Patch application failed: content mismatch or corruption');
            }
            return result;
        } catch (error) {
            if (error instanceof StateConsistencyError) throw error;
            const message = error instanceof Error ? error.message : 'Unknown diff application error';
            throw new StateConsistencyError(`Diff application failed: ${message}`);
        }
    }

    static calculateDiffSize(diffPatch: string): number {
        return strToU8(diffPatch).length;
    }
}

// --- Concurrency Control (Keyed Mutex) ---
class KeyedMutex {
    private readonly locks = new Map<string, Promise<void>>();
    private readonly resolvers = new Map<string, () => void>();

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let resolver!: () => void;
        const promise = new Promise<void>((resolve) => {
            resolver = resolve;
        });

        this.locks.set(key, promise);
        this.resolvers.set(key, resolver);

        try {
            return await operation();
        } finally {
            this.locks.delete(key);
            this.resolvers.delete(key);
            resolver();
        }
    }

    get activeKeys(): readonly string[] {
        return freeze([...this.locks.keys()]);
    }
}

const mutex = new KeyedMutex();

// --- Reconstruction Service ---
class ReconstructionService {
    static async reconstructFromMap(
        targetEditId: string,
        editMap: Map<string, StoredEdit>,
        verify: boolean = true
    ): Promise<ReconstructionResult> {
        const target = editMap.get(targetEditId);
        if (!target) {
            throw new ValidationError(`Target edit ${targetEditId} not found`, 'targetEditId');
        }

        const chain = this.buildChain(targetEditId, editMap);
        const content = await this.applyChain(chain);
        const hash = await HashService.computeHash(content);

        let verified = true;
        if (verify && target.contentHash && target.contentHash.length > 0) {
            verified = hash === target.contentHash;
            if (!verified) {
                throw new IntegrityError(
                    `Content integrity check failed for edit ${targetEditId}`,
                    target.contentHash,
                    hash
                );
            }
        }

        return freeze({ content, hash, verified });
    }

    private static buildChain(
        targetEditId: string,
        editMap: Map<string, StoredEdit>
    ): readonly StoredEdit[] {
        const chain: StoredEdit[] = [];
        const visited = new Set<string>();
        let currentId: string | undefined = targetEditId;

        while (currentId !== undefined) {
            if (visited.has(currentId)) {
                throw new StateConsistencyError(`Circular reference detected at ${currentId}`);
            }
            visited.add(currentId);

            const record = editMap.get(currentId);
            if (!record) {
                throw new StateConsistencyError(`Missing edit record in chain: ${currentId}`);
            }

            chain.push(record);

            if (record.storageType === 'full') {
                break;
            }

            currentId = record.previousEditId;

            if (currentId === undefined && record.storageType === 'diff') {
                throw new StateConsistencyError(`Broken chain: diff ${record.editId} missing previousEditId`);
            }
        }

        return freeze(chain);
    }

    private static async applyChain(chain: readonly StoredEdit[]): Promise<string> {
        if (chain.length === 0) {
            throw new StateConsistencyError('Empty chain - no base record found');
        }

        const reversed = [...chain].reverse();
        const baseRecord = reversed[0];
        if (!baseRecord) {
            throw new StateConsistencyError('No base record in chain');
        }

        let content = await CompressionService.decompress(baseRecord);

        for (let i = 1; i < reversed.length; i++) {
            const edit = reversed[i];
            if (!edit) continue;
            const patch = await CompressionService.decompress(edit);
            content = DiffService.applyDiff(content, patch);
        }

        return content;
    }
}

// --- Context Service ---
class ContextService {
    static async getPreviousEditContext(
        noteId: string,
        branchName: string
    ): Promise<PreviousEditContext | null> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        if (edits.length === 0) {
            return null;
        }

        const sortedEdits = sortBy(edits, [(e) => e.createdAt]);
        const lastEdit = sortedEdits[sortedEdits.length - 1];
        if (!lastEdit) {
            return null;
        }

        const editMap = new Map(sortedEdits.map((e) => [e.editId, e]));

        const result = await ReconstructionService.reconstructFromMap(lastEdit.editId, editMap, false);

        let baseEditId = lastEdit.baseEditId;
        if (lastEdit.storageType === 'full') {
            baseEditId = lastEdit.editId;
        } else if (!baseEditId) {
            for (let i = sortedEdits.length - 1; i >= 0; i--) {
                const edit = sortedEdits[i];
                if (edit && edit.storageType === 'full') {
                    baseEditId = edit.editId;
                    break;
                }
            }
        }

        return freeze({
            editId: lastEdit.editId,
            content: result.content,
            contentHash: result.hash,
            baseEditId: baseEditId ?? lastEdit.editId,
            chainLength: lastEdit.chainLength
        });
    }
}

// --- Manifest Service (Immutable Updates with Immer) ---
class ManifestService {
    static updateManifestWithEditInfo(
        manifest: NoteManifest,
        branchName: string,
        editId: string,
        compressedSize: number,
        uncompressedSize: number,
        contentHash: string
    ): NoteManifest {
        return produce(manifest, (draft) => {
            const branch = draft.branches[branchName];
            if (branch) {
                const version = branch.versions[editId] as {
                    compressedSize?: number;
                    uncompressedSize?: number;
                    contentHash?: string;
                } | undefined;
                if (version) {
                    version.compressedSize = compressedSize;
                    version.uncompressedSize = uncompressedSize;
                    version.contentHash = contentHash;
                }
            }
        });
    }

    static updateManifestPath(manifest: NoteManifest, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.notePath = newPath;
        });
    }

    static updateManifestNoteId(manifest: NoteManifest, newNoteId: string, newPath: string): NoteManifest {
        return produce(manifest, (draft) => {
            draft.noteId = newNoteId;
            draft.notePath = newPath;
        });
    }
}

// --- Utility Functions ---
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEditRecord(params: {
    noteId: string;
    branchName: string;
    editId: string;
    content: ArrayBuffer;
    contentHash: string;
    storageType: StorageType;
    chainLength: number;
    uncompressedSize: number;
    baseEditId?: string;
    previousEditId?: string;
}): StoredEdit {
    const record: StoredEdit = {
        noteId: params.noteId,
        branchName: params.branchName,
        editId: params.editId,
        content: params.content,
        contentHash: params.contentHash,
        storageType: params.storageType,
        chainLength: params.chainLength,
        createdAt: Date.now(),
        size: params.content.byteLength,
        uncompressedSize: params.uncompressedSize
    };

    if (params.baseEditId !== undefined) {
        (record as { baseEditId: string }).baseEditId = params.baseEditId;
    }
    if (params.previousEditId !== undefined) {
        (record as { previousEditId: string }).previousEditId = params.previousEditId;
    }

    return freeze(record);
}

// --- Worker API Implementation ---
const editHistoryApi = {
    async saveEdit(
        noteId: unknown,
        branchName: unknown,
        editId: unknown,
        content: unknown,
        manifestUpdate: unknown
    ): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validEditId = validateInput(EditIdSchema, editId, 'editId');
        const validContent = validateInput(ContentSchema, content, 'content');
        const validManifest = validateInput(ManifestSchema, manifestUpdate, 'manifest') as NoteManifest;

        return mutex.run(validNoteId, async () => {
            const contentStr =
                typeof validContent === 'string'
                    ? validContent
                    : CompressionService.textDecoder.decode(validContent);

            const contentHash = await HashService.computeHash(contentStr);
            const uncompressedSize = CompressionService.getUncompressedSize(contentStr);

            for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
                const existsOptimistic = await db.edits
                    .where('[noteId+branchName+editId]')
                    .equals([validNoteId, validBranchName, validEditId])
                    .count();

                if (existsOptimistic > 0) {
                    return;
                }

                const previousContext = await ContextService.getPreviousEditContext(validNoteId, validBranchName);

                let compressedContent: ArrayBuffer;
                let storageType: StorageType;
                let baseEditId: string | undefined;
                let previousEditId: string | undefined;
                let chainLength: number;

                if (!previousContext) {
                    compressedContent = CompressionService.compressContent(contentStr);
                    storageType = 'full';
                    chainLength = 0;
                } else {
                    const isChainTooLong = previousContext.chainLength >= CONFIG.MAX_CHAIN_LENGTH;

                    if (isChainTooLong) {
                        compressedContent = CompressionService.compressContent(contentStr);
                        storageType = 'full';
                        chainLength = 0;
                        previousEditId = previousContext.editId;
                    } else {
                        const diffPatch = DiffService.createDiff(previousContext.content, contentStr, validEditId);
                        const diffSize = DiffService.calculateDiffSize(diffPatch);
                        const fullSize = uncompressedSize;

                        if (diffSize < fullSize * CONFIG.DIFF_SIZE_THRESHOLD) {
                            compressedContent = CompressionService.compressContent(diffPatch);
                            storageType = 'diff';
                            baseEditId = previousContext.baseEditId;
                            previousEditId = previousContext.editId;
                            chainLength = previousContext.chainLength + 1;
                        } else {
                            compressedContent = CompressionService.compressContent(contentStr);
                            storageType = 'full';
                            chainLength = 0;
                            previousEditId = previousContext.editId;
                        }
                    }
                }

                const editRecord = createEditRecord({
                    noteId: validNoteId,
                    branchName: validBranchName,
                    editId: validEditId,
                    content: compressedContent,
                    contentHash,
                    storageType,
                    chainLength,
                    uncompressedSize,
                    ...(baseEditId !== undefined && { baseEditId }),
                    ...(previousEditId !== undefined && { previousEditId })
                });

                const updatedManifest = ManifestService.updateManifestWithEditInfo(
                    validManifest,
                    validBranchName,
                    validEditId,
                    compressedContent.byteLength,
                    uncompressedSize,
                    contentHash
                );

                let committed = false;

                await db.transaction('rw', db.edits, db.manifests, async () => {
                    const existing = await db.edits
                        .where('[noteId+branchName+editId]')
                        .equals([validNoteId, validBranchName, validEditId])
                        .count();

                    if (existing > 0) {
                        committed = true;
                        return;
                    }

                    const currentHead = await db.edits
                        .where('[noteId+branchName]')
                        .equals([validNoteId, validBranchName])
                        .last();

                    const currentHeadId = currentHead?.editId;
                    const previousContextId = previousContext?.editId;

                    if (currentHeadId !== previousContextId) {
                        return;
                    }

                    await db.edits.put({ ...editRecord } as StoredEdit);
                    await db.manifests.put({
                        noteId: validNoteId,
                        manifest: updatedManifest,
                        updatedAt: Date.now()
                    });

                    committed = true;
                });

                if (committed) {
                    return;
                }

                if (attempt < CONFIG.MAX_RETRIES - 1) {
                    await sleep(CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
                }
            }

            throw new StateConsistencyError('Failed to save edit after maximum retries due to concurrent modifications');
        });
    },

    async getEditContent(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<ArrayBuffer | null> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validEditId = validateInput(EditIdSchema, editId, 'editId');

        return mutex.run(validNoteId, async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([validNoteId, validBranchName])
                .toArray();

            const editMap = new Map(edits.map((e) => [e.editId, e]));

            if (!editMap.has(validEditId)) {
                return null;
            }

            const result = await ReconstructionService.reconstructFromMap(validEditId, editMap, true);

            const buffer = CompressionService.textEncoder.encode(result.content).buffer as ArrayBuffer;
            return transfer(buffer, [buffer]);
        });
    },

    async getEditManifest(noteId: unknown): Promise<NoteManifest | null> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');

        return mutex.run(validNoteId, async () => {
            const record = await db.manifests.get(validNoteId);
            return record ? freeze(record.manifest) : null;
        });
    },

    async saveEditManifest(noteId: unknown, manifest: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validManifest = validateInput(ManifestSchema, manifest, 'manifest') as NoteManifest;

        return mutex.run(validNoteId, async () => {
            await db.manifests.put({
                noteId: validNoteId,
                manifest: validManifest,
                updatedAt: Date.now()
            });
        });
    },

    async deleteEdit(noteId: unknown, branchName: unknown, editId: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validEditId = validateInput(EditIdSchema, editId, 'editId');

        return mutex.run(validNoteId, async () => {
            await db.transaction('rw', db.edits, async () => {
                const branchEdits = await db.edits
                    .where('[noteId+branchName]')
                    .equals([validNoteId, validBranchName])
                    .toArray();

                const editMap = new Map(branchEdits.map((e) => [e.editId, e]));
                const targetEdit = editMap.get(validEditId);

                if (!targetEdit) {
                    return;
                }

                const children = branchEdits.filter((e) => e.previousEditId === validEditId);
                const updates: StoredEdit[] = [];

                for (const child of children) {
                    const result = await ReconstructionService.reconstructFromMap(child.editId, editMap, false);
                    const childContentHash = await HashService.computeHash(result.content);
                    const compressedContent = CompressionService.compressContent(result.content);
                    const childUncompressedSize = CompressionService.getUncompressedSize(result.content);

                    const updatedChild = produce(child, (draft) => {
                        draft.storageType = 'full';
                        draft.content = compressedContent;
                        draft.contentHash = childContentHash;
                        draft.baseEditId = draft.editId;
                        draft.chainLength = 0;
                        draft.size = compressedContent.byteLength;
                        draft.uncompressedSize = childUncompressedSize;

                        if (targetEdit.previousEditId) {
                            draft.previousEditId = targetEdit.previousEditId;
                        } else {
                            delete draft.previousEditId;
                        }
                    });

                    updates.push(updatedChild);

                    const queue = [child.editId];
                    const visited = new Set([child.editId]);

                    while (queue.length > 0) {
                        const currentId = queue.shift()!;
                        const descendants = branchEdits.filter((e) => e.previousEditId === currentId);

                        for (const descendant of descendants) {
                            if (!visited.has(descendant.editId)) {
                                visited.add(descendant.editId);
                                queue.push(descendant.editId);

                                const parentUpdate = updates.find((u) => u.editId === descendant.previousEditId);
                                const parent = parentUpdate ?? editMap.get(descendant.previousEditId!);
                                const newChainLength = parent ? parent.chainLength + 1 : 1;

                                const updatedDescendant = produce(descendant, (draft) => {
                                    draft.baseEditId = child.editId;
                                    draft.chainLength = newChainLength;
                                });

                                const existingIdx = updates.findIndex((u) => u.editId === updatedDescendant.editId);
                                if (existingIdx >= 0) {
                                    updates[existingIdx] = updatedDescendant;
                                } else {
                                    updates.push(updatedDescendant);
                                }
                            }
                        }
                    }
                }

                if (updates.length > 0) {
                    await db.edits.bulkPut(updates.map((u) => ({ ...u })));
                }

                if (targetEdit.id !== undefined) {
                    await db.edits.delete(targetEdit.id);
                }
            });
        });
    },

    async deleteNoteHistory(noteId: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');

        return mutex.run(validNoteId, async () => {
            await db.transaction('rw', db.edits, db.manifests, async () => {
                await db.edits.where('noteId').equals(validNoteId).delete();
                await db.manifests.delete(validNoteId);
            });
        });
    },

    async renameEdit(noteId: unknown, oldEditId: unknown, newEditId: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validOldEditId = validateInput(EditIdSchema, oldEditId, 'oldEditId');
        const validNewEditId = validateInput(EditIdSchema, newEditId, 'newEditId');

        if (validOldEditId === validNewEditId) {
            return;
        }

        return mutex.run(validNoteId, async () => {
            await db.transaction('rw', db.edits, async () => {
                const oldExists = await db.edits
                    .where({ noteId: validNoteId, editId: validOldEditId })
                    .count();

                if (oldExists === 0) {
                    return;
                }

                const newExists = await db.edits
                    .where({ noteId: validNoteId, editId: validNewEditId })
                    .count();

                if (newExists > 0) {
                    throw new ValidationError(`Edit ${validNewEditId} already exists`, 'newEditId');
                }

                const records = await db.edits
                    .where('noteId')
                    .equals(validNoteId)
                    .filter((e) => e.editId === validOldEditId)
                    .toArray();

                for (const record of records) {
                    if (record.id !== undefined) {
                        await db.edits.update(record.id, { editId: validNewEditId });
                    }
                }

                const dependentRecords = await db.edits
                    .where('noteId')
                    .equals(validNoteId)
                    .filter((e) => e.baseEditId === validOldEditId || e.previousEditId === validOldEditId)
                    .toArray();

                for (const record of dependentRecords) {
                    if (record.id !== undefined) {
                        const updates: Partial<StoredEdit> = {};
                        if (record.baseEditId === validOldEditId) {
                            updates.baseEditId = validNewEditId;
                        }
                        if (record.previousEditId === validOldEditId) {
                            updates.previousEditId = validNewEditId;
                        }
                        if (Object.keys(updates).length > 0) {
                            await db.edits.update(record.id, updates);
                        }
                    }
                }
            });
        });
    },

    async renameNote(oldNoteId: unknown, newNoteId: unknown, newPath: unknown): Promise<void> {
        const validOldNoteId = validateInput(NoteIdSchema, oldNoteId, 'oldNoteId');
        const validNewNoteId = validateInput(NoteIdSchema, newNoteId, 'newNoteId');
        const validNewPath = validateInput(PathSchema, newPath, 'newPath');

        if (validOldNoteId === validNewNoteId) {
            return;
        }

        return mutex.run(validOldNoteId, async () => {
            await db.transaction('rw', db.edits, db.manifests, async () => {
                await db.edits.where('noteId').equals(validOldNoteId).modify({ noteId: validNewNoteId });

                const oldManifestRecord = await db.manifests.get(validOldNoteId);
                if (oldManifestRecord) {
                    const updatedManifest = ManifestService.updateManifestNoteId(
                        oldManifestRecord.manifest,
                        validNewNoteId,
                        validNewPath
                    );

                    await db.manifests.put({
                        noteId: validNewNoteId,
                        manifest: updatedManifest,
                        updatedAt: Date.now()
                    });

                    await db.manifests.delete(validOldNoteId);
                }
            });
        });
    },

    async updateNotePath(noteId: unknown, newPath: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validNewPath = validateInput(PathSchema, newPath, 'newPath');

        return mutex.run(validNoteId, async () => {
            await db.transaction('rw', db.manifests, async () => {
                const record = await db.manifests.get(validNoteId);
                if (record) {
                    const updatedManifest = ManifestService.updateManifestPath(record.manifest, validNewPath);

                    await db.manifests.put({
                        noteId: validNoteId,
                        manifest: updatedManifest,
                        updatedAt: Date.now()
                    });
                }
            });
        });
    },

    async getDatabaseStats(): Promise<DatabaseStats> {
        const editCount = await db.edits.count();
        const manifestCount = await db.manifests.count();

        return freeze({
            editCount,
            manifestCount,
            activeKeys: mutex.activeKeys
        });
    },

    async verifyEditIntegrity(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<IntegrityCheckResult> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validEditId = validateInput(EditIdSchema, editId, 'editId');

        return mutex.run(validNoteId, async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([validNoteId, validBranchName])
                .toArray();

            const editMap = new Map(edits.map((e) => [e.editId, e]));
            const targetEdit = editMap.get(validEditId);

            if (!targetEdit) {
                throw new ValidationError(`Edit ${validEditId} not found`, 'editId');
            }

            const result = await ReconstructionService.reconstructFromMap(validEditId, editMap, false);

            const actualHash = result.hash;
            const expectedHash = targetEdit.contentHash || '';
            const valid = expectedHash === '' || isEqual(actualHash, expectedHash);

            return freeze({ valid, expectedHash, actualHash });
        });
    },

    async verifyBranchIntegrity(
        noteId: unknown,
        branchName: unknown
    ): Promise<readonly IntegrityCheckResult[]> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');

        return mutex.run(validNoteId, async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([validNoteId, validBranchName])
                .toArray();

            const editMap = new Map(edits.map((e) => [e.editId, e]));
            const results: IntegrityCheckResult[] = [];

            for (const edit of edits) {
                try {
                    const result = await ReconstructionService.reconstructFromMap(edit.editId, editMap, false);
                    const actualHash = result.hash;
                    const expectedHash = edit.contentHash || '';
                    const valid = expectedHash === '' || actualHash === expectedHash;

                    results.push(freeze({ valid, expectedHash, actualHash }));
                } catch {
                    results.push(freeze({ valid: false, expectedHash: edit.contentHash || '', actualHash: '' }));
                }
            }

            return freeze(results);
        });
    }
};

expose(editHistoryApi);

export type EditHistoryApi = typeof editHistoryApi;
export type { StoredEdit, StoredManifest, StorageType, ReconstructionResult, PreviousEditContext, DatabaseStats, IntegrityCheckResult };
export { ValidationError, SecurityError, StateConsistencyError, IntegrityError };
