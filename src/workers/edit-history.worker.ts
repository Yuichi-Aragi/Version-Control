/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { Dexie, type Table } from 'dexie';
import { createPatch, applyPatch } from 'diff';
import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate';
import type { NoteManifest } from '../types';

// --- Constants & Configuration ---
const MAX_CHAIN_LENGTH = 50;
const DIFF_SIZE_THRESHOLD = 0.8;
const DB_NAME = 'VersionControlEditHistoryDB';
const COMPRESSION_LEVEL = 9; // Balanced compression (0-9)
const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB safety limit

// --- Types & Interfaces ---
type StorageType = 'full' | 'diff';

interface StoredEdit {
    id?: number;
    noteId: string;
    branchName: string;
    editId: string;
    content: ArrayBuffer;
    storageType: StorageType;
    baseEditId?: string;
    previousEditId?: string;
    chainLength: number;
    createdAt: number;
    size: number;
}

interface StoredManifest {
    noteId: string;
    manifest: NoteManifest;
    updatedAt: number;
}

// --- Validation & Security Utilities ---
class ValidationError extends Error {
    constructor(message: string, public readonly field?: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecurityError';
    }
}

class StateConsistencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StateConsistencyError';
    }
}

class InputValidator {
    private static readonly MAX_ID_LENGTH = 255;

    static validateNoteId(noteId: unknown): string {
        if (typeof noteId !== 'string') {
            throw new ValidationError('noteId must be a string', 'noteId');
        }
        if (noteId.length === 0 || noteId.length > this.MAX_ID_LENGTH) {
            throw new ValidationError(`noteId length must be between 1 and ${this.MAX_ID_LENGTH} characters`, 'noteId');
        }
        return noteId;
    }

    static validateBranchName(branchName: unknown): string {
        if (typeof branchName !== 'string') {
            throw new ValidationError('branchName must be a string', 'branchName');
        }
        if (branchName.length === 0 || branchName.length > this.MAX_ID_LENGTH) {
            throw new ValidationError(`branchName length must be between 1 and ${this.MAX_ID_LENGTH} characters`, 'branchName');
        }
        return branchName;
    }

    static validateEditId(editId: unknown): string {
        if (typeof editId !== 'string') {
            throw new ValidationError('editId must be a string', 'editId');
        }
        if (editId.length === 0 || editId.length > this.MAX_ID_LENGTH) {
            throw new ValidationError(`editId length must be between 1 and ${this.MAX_ID_LENGTH} characters`, 'editId');
        }
        return editId;
    }

    static validateContent(content: unknown): string | ArrayBuffer {
        if (typeof content === 'string') {
            if (content.length > MAX_CONTENT_SIZE) {
                throw new ValidationError(`Content size exceeds maximum limit of ${MAX_CONTENT_SIZE} bytes`, 'content');
            }
            return content;
        } else if (content instanceof ArrayBuffer) {
            if (content.byteLength > MAX_CONTENT_SIZE) {
                throw new ValidationError(`Content size exceeds maximum limit of ${MAX_CONTENT_SIZE} bytes`, 'content');
            }
            return content;
        }
        throw new ValidationError('content must be a string or ArrayBuffer', 'content');
    }

    static validateManifest(manifest: unknown): NoteManifest {
        if (!manifest || typeof manifest !== 'object') {
            throw new ValidationError('manifest must be an object', 'manifest');
        }
        // Basic structure validation - can be expanded based on NoteManifest type definition
        const man = manifest as Partial<NoteManifest>;
        if (!man.noteId || typeof man.noteId !== 'string') {
            throw new ValidationError('manifest.noteId must be a non-empty string', 'manifest.noteId');
        }
        return manifest as NoteManifest;
    }

    static sanitizeString(input: string): string {
        return input.trim().replace(/\0/g, ''); // Remove null characters
    }
}

// --- Database ---
class EditHistoryDB extends Dexie {
    public edits!: Table<StoredEdit, number>;
    public manifests!: Table<StoredManifest, string>;

    constructor() {
        super(DB_NAME);
        this.configureDatabase();
    }

    private configureDatabase(): void {
        // Version 1: Initial schema
        this.version(1).stores({
            edits: '++id, [noteId+editId], noteId',
            manifests: 'noteId'
        });

        // Version 2: Add branch support
        this.version(2).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt',
            manifests: 'noteId, updatedAt'
        }).upgrade(tx => {
            return tx.table('edits').toCollection().modify(edit => {
                if (!edit.branchName) edit.branchName = 'main';
                if (!edit.createdAt) edit.createdAt = Date.now();
                if (!edit.storageType) edit.storageType = 'full';
                if (!edit.chainLength) edit.chainLength = 0;
                if (!edit.size) edit.size = edit.content.byteLength;
            });
        });

        // Version 3: Add indices for better query performance
        this.version(3).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });

        // Version 4: Add size index for cleanup operations
        this.version(4).stores({
            edits: '++id, [noteId+branchName+editId], [noteId+branchName], noteId, createdAt, size, [noteId+branchName+createdAt]',
            manifests: 'noteId, updatedAt'
        });
    }
}

const db = new EditHistoryDB();

// --- Compression Utilities ---
class CompressionService {
    public static readonly textEncoder = new TextEncoder();
    public static readonly textDecoder = new TextDecoder('utf-8');

    static compressContent(content: string): ArrayBuffer {
        try {
            const data = strToU8(content);
            const compressed = compressSync(data, { level: COMPRESSION_LEVEL });
            return compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            ) as ArrayBuffer;
        } catch (error) {
            throw new SecurityError(`Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    static decompressContent(buffer: ArrayBuffer): string {
        try {
            if (buffer.byteLength === 0) {
                throw new ValidationError('Cannot decompress empty buffer', 'buffer');
            }
            const compressed = new Uint8Array(buffer);
            const decompressed = decompressSync(compressed);
            return strFromU8(decompressed);
        } catch (error) {
            throw new SecurityError(`Decompression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    static async decompressLegacy(buffer: ArrayBuffer): Promise<string> {
        try {
            if (buffer.byteLength === 0) {
                throw new ValidationError('Cannot decompress empty legacy buffer', 'buffer');
            }
            const stream = new Blob([buffer]).stream();
            const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
            const resultBuffer = await new Response(decompressed).arrayBuffer();
            return this.textDecoder.decode(resultBuffer);
        } catch (error) {
            console.error("Legacy decompression failed", error);
            throw new SecurityError("Failed to decompress legacy content");
        }
    }

    static async decompress(record: StoredEdit): Promise<string> {
        if (!record.storageType) {
            // CRITICAL FIX: Wrap the async legacy decompression in Dexie.waitFor.
            // This prevents the Dexie transaction from auto-committing when awaiting 
            // the non-IndexedDB promise returned by decompressLegacy.
            return Dexie.waitFor(this.decompressLegacy(record.content));
        }
        return this.decompressContent(record.content);
    }
}

// --- Diff Utilities ---
class DiffService {
    static createDiff(oldContent: string, newContent: string, editId: string): string {
        if (!oldContent || !newContent) {
            throw new ValidationError('Cannot create diff from empty content', 'content');
        }
        try {
            return createPatch(
                `edit_${editId}`,
                oldContent,
                newContent,
                '',
                '',
                { context: 3 }
            );
        } catch (error) {
            throw new StateConsistencyError(`Diff creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    static applyDiff(baseContent: string, patch: string): string {
        if (!baseContent || !patch) {
            throw new ValidationError('Cannot apply diff with empty parameters', 'parameters');
        }
        try {
            const result = applyPatch(baseContent, patch);
            if (result === false) {
                throw new StateConsistencyError("Failed to apply patch: mismatch or corruption detected");
            }
            return result;
        } catch (error) {
            throw new StateConsistencyError(`Diff application failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

// --- Concurrency Control ---
class KeyedMutex {
    private locks = new Map<string, { promise: Promise<void>; resolve: () => void }>();

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const currentLock = this.locks.get(key);
        
        if (currentLock) {
            // Wait for existing lock
            await currentLock.promise;
        }

        // Create new lock
        let resolveFn: () => void;
        const promise = new Promise<void>(resolve => {
            resolveFn = resolve;
        });
        
        this.locks.set(key, { promise, resolve: resolveFn! });

        try {
            return await operation();
        } finally {
            // Release lock
            this.locks.delete(key);
            resolveFn!();
        }
    }

    get isLocked(): Map<string, boolean> {
        const status = new Map<string, boolean>();
        for (const [key] of this.locks) {
            status.set(key, true);
        }
        return status;
    }
}

const mutex = new KeyedMutex();

// --- Core Logic ---
class ReconstructionService {
    static async reconstructFromMap(
        targetEditId: string,
        editMap: Map<string, StoredEdit>
    ): Promise<string> {
        if (!targetEditId || !editMap.has(targetEditId)) {
            throw new ValidationError(`Target edit ${targetEditId} not found in map`, 'targetEditId');
        }

        const chain: StoredEdit[] = [];
        let currentId: string | undefined = targetEditId;
        const visited = new Set<string>();

        while (currentId) {
            if (visited.has(currentId)) {
                throw new StateConsistencyError(`Circular reference detected in edit chain at ${currentId}`);
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

            if (!currentId && record.storageType === 'diff') {
                throw new StateConsistencyError(`Broken chain: diff entry ${record.editId} missing previousEditId`);
            }
        }

        const baseRecord = chain.pop();
        if (!baseRecord) {
            throw new StateConsistencyError("Chain empty - no base record found");
        }

        const decompressionCache = new Map<number, string>();
        let content = await this.decompressWithCache(baseRecord, decompressionCache);

        while (chain.length > 0) {
            const nextEdit = chain.pop()!;
            const patch = await this.decompressWithCache(nextEdit, decompressionCache);
            content = DiffService.applyDiff(content, patch);
        }

        return content;
    }

    private static async decompressWithCache(
        record: StoredEdit,
        cache: Map<number, string>
    ): Promise<string> {
        if (record.id === undefined) {
            return await CompressionService.decompress(record);
        }

        const cached = cache.get(record.id);
        if (cached !== undefined) {
            return cached;
        }

        const content = await CompressionService.decompress(record);
        cache.set(record.id, content);
        return content;
    }
}

class ContextService {
    static async getPreviousEditContext(
        noteId: string,
        branchName: string
    ): Promise<{ editId: string; content: string; baseEditId: string; chainLength: number } | null> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .sortBy('createdAt');

        if (edits.length === 0) {
            return null;
        }

        const lastEdit = edits[edits.length - 1];
        if (!lastEdit) {
            throw new StateConsistencyError('Failed to retrieve last edit');
        }

        const editMap = new Map(edits.map(e => [e.editId, e]));

        try {
            const content = await ReconstructionService.reconstructFromMap(lastEdit.editId, editMap);

            let baseEditId = lastEdit.baseEditId;
            if (lastEdit.storageType === 'full') {
                baseEditId = lastEdit.editId;
            } else if (!baseEditId) {
                // Find nearest full snapshot
                for (let i = edits.length - 1; i >= 0; i--) {
                    const edit = edits[i];
                    if (edit && edit.storageType === 'full') {
                        baseEditId = edit.editId;
                        break;
                    }
                }
            }

            return {
                editId: lastEdit.editId,
                content,
                baseEditId: baseEditId || lastEdit.editId,
                chainLength: lastEdit.chainLength
            };
        } catch (error) {
            console.error("Failed to get previous context", error);
            throw new StateConsistencyError(`Failed to reconstruct context: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
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
        // Input validation
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        const validatedBranchName = InputValidator.validateBranchName(branchName);
        const validatedEditId = InputValidator.validateEditId(editId);
        const validatedContent = InputValidator.validateContent(content);
        const validatedManifest = InputValidator.validateManifest(manifestUpdate);

        return mutex.run(validatedNoteId, async () => {
            // Decode content once
            const contentStr = typeof validatedContent === 'string'
                ? validatedContent
                : CompressionService.textDecoder.decode(validatedContent);

            // Optimistic Concurrency Control with Retry Loop
            const MAX_RETRIES = 3;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                
                // 1. READ & COMPUTE PHASE (Outside Transaction)
                // We perform the heavy lifting (reconstruction, diffing, compression) outside
                // the transaction to prevent locking the DB and to avoid "commit too early" issues
                // caused by async operations (like legacy decompression).

                // Optimistic Idempotency Check
                const existsOptimistic = await db.edits
                    .where('[noteId+branchName+editId]')
                    .equals([validatedNoteId, validatedBranchName, validatedEditId])
                    .count();
                
                if (existsOptimistic > 0) return; // Already saved

                // Get Context
                const previousContext = await ContextService.getPreviousEditContext(
                    validatedNoteId,
                    validatedBranchName
                );

                let compressedContent: ArrayBuffer;
                let storageType: StorageType;
                let baseEditId: string | undefined;
                let previousEditId: string | undefined;
                let chainLength: number;

                if (!previousContext) {
                    // First edit
                    compressedContent = CompressionService.compressContent(contentStr);
                    storageType = 'full';
                    chainLength = 0;
                } else {
                    const isChainTooLong = previousContext.chainLength >= MAX_CHAIN_LENGTH;

                    if (isChainTooLong) {
                        // Force full snapshot
                        compressedContent = CompressionService.compressContent(contentStr);
                        storageType = 'full';
                        chainLength = 0;
                        previousEditId = previousContext.editId;
                    } else {
                        // Try Diff
                        const diffPatch = DiffService.createDiff(
                            previousContext.content,
                            contentStr,
                            validatedEditId
                        );
                        const diffSize = strToU8(diffPatch).length;
                        const fullSize = strToU8(contentStr).length;

                        if (diffSize < fullSize * DIFF_SIZE_THRESHOLD) {
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

                const editRecord: StoredEdit = {
                    noteId: validatedNoteId,
                    branchName: validatedBranchName,
                    editId: validatedEditId,
                    content: compressedContent,
                    storageType,
                    chainLength,
                    createdAt: Date.now(),
                    size: compressedContent.byteLength
                };

                if (baseEditId !== undefined) editRecord.baseEditId = baseEditId;
                if (previousEditId !== undefined) editRecord.previousEditId = previousEditId;

                // Update manifest with compressed/uncompressed sizes
                const branch = validatedManifest.branches[validatedBranchName];
                if (branch && branch.versions[validatedEditId]) {
                    const versionEntry = branch.versions[validatedEditId];
                    if (versionEntry) {
                        versionEntry.compressedSize = compressedContent.byteLength;
                        // Ensure uncompressedSize is set if not already (it should be set by thunk, but safety check)
                        if (versionEntry.uncompressedSize === undefined) {
                            versionEntry.uncompressedSize = strToU8(contentStr).length;
                        }
                    }
                }

                // 2. WRITE PHASE (Inside Transaction)
                let committed = false;
                await db.transaction('rw', db.edits, db.manifests, async () => {
                    // Final Idempotency Check
                    const existing = await db.edits
                        .where('[noteId+branchName+editId]')
                        .equals([validatedNoteId, validatedBranchName, validatedEditId])
                        .count();

                    if (existing > 0) {
                        committed = true;
                        return;
                    }

                    // Consistency Check: Ensure the head of the branch hasn't moved
                    // since we read the context.
                    const currentHead = await db.edits
                        .where('[noteId+branchName]')
                        .equals([validatedNoteId, validatedBranchName])
                        .last();

                    const currentHeadId = currentHead?.editId;
                    const previousContextId = previousContext?.editId;

                    if (currentHeadId !== previousContextId) {
                        // Conflict detected (concurrent write), abort transaction and retry loop
                        return;
                    }

                    await db.edits.put(editRecord);
                    await db.manifests.put({
                        noteId: validatedNoteId,
                        manifest: validatedManifest,
                        updatedAt: Date.now()
                    });
                    committed = true;
                });

                if (committed) return;
            }
            
            throw new StateConsistencyError("Failed to save edit after retries due to concurrent modifications");
        });
    },

    async getEditContent(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<ArrayBuffer | null> {
        // Input validation
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        const validatedBranchName = InputValidator.validateBranchName(branchName);
        const validatedEditId = InputValidator.validateEditId(editId);

        return mutex.run(validatedNoteId, async () => {
            try {
                const edits = await db.edits
                    .where('[noteId+branchName]')
                    .equals([validatedNoteId, validatedBranchName])
                    .toArray();

                const editMap = new Map(edits.map(e => [e.editId, e]));

                if (!editMap.has(validatedEditId)) {
                    return null;
                }

                const content = await ReconstructionService.reconstructFromMap(
                    validatedEditId,
                    editMap
                );

                const buffer = CompressionService.textEncoder.encode(content).buffer;
                return transfer(buffer, [buffer]);
            } catch (error) {
                console.error("Reconstruction failed", error);
                return null;
            }
        });
    },

    async getEditManifest(noteId: unknown): Promise<NoteManifest | null> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);

        return mutex.run(validatedNoteId, async () => {
            try {
                const record = await db.manifests.get(validatedNoteId);
                return record ? record.manifest : null;
            } catch (error) {
                console.error("Failed to get manifest", error);
                return null;
            }
        });
    },

    async saveEditManifest(
        noteId: unknown,
        manifest: unknown
    ): Promise<void> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        const validatedManifest = InputValidator.validateManifest(manifest);

        return mutex.run(validatedNoteId, async () => {
            await db.manifests.put({
                noteId: validatedNoteId,
                manifest: validatedManifest,
                updatedAt: Date.now()
            });
        });
    },

    async deleteEdit(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<void> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        const validatedBranchName = InputValidator.validateBranchName(branchName);
        const validatedEditId = InputValidator.validateEditId(editId);

        return mutex.run(validatedNoteId, async () => {
            await db.transaction('rw', db.edits, async () => {
                const branchEdits = await db.edits
                    .where('[noteId+branchName]')
                    .equals([validatedNoteId, validatedBranchName])
                    .toArray();

                const editMap = new Map(branchEdits.map(e => [e.editId, e]));
                const targetEdit = editMap.get(validatedEditId);

                if (!targetEdit) {
                    return; // Idempotent: already deleted
                }

                const children = branchEdits.filter(e => e.previousEditId === validatedEditId);
                const updates: StoredEdit[] = [];

                // Heal Children
                for (const child of children) {
                    try {
                        const content = await ReconstructionService.reconstructFromMap(child.editId, editMap);

                        const updatedChild: StoredEdit = {
                            ...child,
                            storageType: 'full',
                            content: CompressionService.compressContent(content),
                            baseEditId: child.editId,
                            chainLength: 0
                        };

                        if (targetEdit.previousEditId) {
                            updatedChild.previousEditId = targetEdit.previousEditId;
                        } else {
                            delete updatedChild.previousEditId;
                        }

                        updates.push(updatedChild);

                        // Update descendants with BFS
                        const queue = [child.editId];
                        const visited = new Set([child.editId]);

                        while (queue.length > 0) {
                            const currentId = queue.shift()!;
                            const descendants = branchEdits.filter(e => e.previousEditId === currentId);

                            for (const descendant of descendants) {
                                if (!visited.has(descendant.editId)) {
                                    visited.add(descendant.editId);
                                    queue.push(descendant.editId);

                                    const updatedDescendant: StoredEdit = {
                                        ...descendant,
                                        baseEditId: child.editId
                                    };

                                    // Recalculate chain length
                                    const parentUpdate = updates.find(u => u.editId === updatedDescendant.previousEditId);
                                    const parent = parentUpdate || editMap.get(updatedDescendant.previousEditId!);

                                    if (parent) {
                                        updatedDescendant.chainLength = parent.chainLength + 1;
                                    } else {
                                        updatedDescendant.chainLength = 1;
                                    }

                                    const existingIndex = updates.findIndex(u => u.editId === updatedDescendant.editId);
                                    if (existingIndex > -1) {
                                        updates[existingIndex] = updatedDescendant;
                                    } else {
                                        updates.push(updatedDescendant);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Failed to heal child ${child.editId}`, error);
                        throw new StateConsistencyError(`Delete failed: graph healing error - ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }

                // Write updates and delete target
                if (updates.length > 0) {
                    await db.edits.bulkPut(updates);
                }
                if (targetEdit.id !== undefined) {
                    await db.edits.delete(targetEdit.id);
                }
            });
        });
    },

    async deleteNoteHistory(noteId: unknown): Promise<void> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);

        return mutex.run(validatedNoteId, async () => {
            await db.transaction('rw', db.edits, db.manifests, async () => {
                await db.edits.where('noteId').equals(validatedNoteId).delete();
                await db.manifests.delete(validatedNoteId);
            });
        });
    },

    async renameEdit(
        noteId: unknown,
        oldEditId: unknown,
        newEditId: unknown
    ): Promise<void> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        const validatedOldEditId = InputValidator.validateEditId(oldEditId);
        const validatedNewEditId = InputValidator.validateEditId(newEditId);

        if (validatedOldEditId === validatedNewEditId) {
            throw new ValidationError('oldEditId and newEditId must be different');
        }

        return mutex.run(validatedNoteId, async () => {
            await db.transaction('rw', db.edits, async () => {
                // Check existence
                const oldExists = await db.edits
                    .where({ noteId: validatedNoteId, editId: validatedOldEditId })
                    .count();

                if (oldExists === 0) {
                    return; // Idempotent
                }

                const newExists = await db.edits
                    .where({ noteId: validatedNoteId, editId: validatedNewEditId })
                    .count();

                if (newExists > 0) {
                    throw new ValidationError(`Rename failed: ${validatedNewEditId} already exists`);
                }

                // Update target records
                const records = await db.edits
                    .where('noteId')
                    .equals(validatedNoteId)
                    .filter(e => e.editId === validatedOldEditId)
                    .toArray();

                for (const record of records) {
                    if (record.id !== undefined) {
                        await db.edits.update(record.id, { editId: validatedNewEditId });
                    }
                }

                // Update references
                const dependentRecords = await db.edits
                    .where('noteId')
                    .equals(validatedNoteId)
                    .filter(e => e.baseEditId === validatedOldEditId || e.previousEditId === validatedOldEditId)
                    .toArray();

                for (const record of dependentRecords) {
                    if (record.id !== undefined) {
                        const updates: Partial<StoredEdit> = {};
                        if (record.baseEditId === validatedOldEditId) {
                            updates.baseEditId = validatedNewEditId;
                        }
                        if (record.previousEditId === validatedOldEditId) {
                            updates.previousEditId = validatedNewEditId;
                        }
                        await db.edits.update(record.id, updates);
                    }
                }
            });
        });
    },

    async renameNote(
        oldNoteId: unknown,
        newNoteId: unknown,
        newPath: unknown
    ): Promise<void> {
        const validatedOldNoteId = InputValidator.validateNoteId(oldNoteId);
        const validatedNewNoteId = InputValidator.validateNoteId(newNoteId);
        // Path validation is loose as it's just a string storage
        if (typeof newPath !== 'string') throw new ValidationError('newPath must be a string', 'newPath');

        if (validatedOldNoteId === validatedNewNoteId) return;

        // We lock on both IDs to ensure consistency
        // To avoid deadlocks, we could sort them, but since we are inside a worker and calls are serialized by Comlink/MessageQueue mostly,
        // and we use a mutex inside, we just need to be careful.
        // Actually, mutex.run takes a single key. We should lock the old ID as primary.
        
        return mutex.run(validatedOldNoteId, async () => {
            await db.transaction('rw', db.edits, db.manifests, async () => {
                // 1. Update Edits
                await db.edits.where('noteId').equals(validatedOldNoteId).modify({ noteId: validatedNewNoteId });

                // 2. Update Manifest
                const oldManifestRecord = await db.manifests.get(validatedOldNoteId);
                if (oldManifestRecord) {
                    const newManifest = { ...oldManifestRecord.manifest };
                    newManifest.noteId = validatedNewNoteId;
                    newManifest.notePath = newPath;
                    
                    await db.manifests.put({
                        noteId: validatedNewNoteId,
                        manifest: newManifest,
                        updatedAt: Date.now()
                    });
                    
                    await db.manifests.delete(validatedOldNoteId);
                }
            });
        });
    },

    async updateNotePath(
        noteId: unknown,
        newPath: unknown
    ): Promise<void> {
        const validatedNoteId = InputValidator.validateNoteId(noteId);
        if (typeof newPath !== 'string') throw new ValidationError('newPath must be a string', 'newPath');

        return mutex.run(validatedNoteId, async () => {
            await db.transaction('rw', db.manifests, async () => {
                const record = await db.manifests.get(validatedNoteId);
                if (record) {
                    record.manifest.notePath = newPath;
                    record.updatedAt = Date.now();
                    await db.manifests.put(record);
                }
            });
        });
    },

    // Utility method for diagnostics
    async getDatabaseStats(): Promise<{
        editCount: number;
        manifestCount: number;
        locks: Map<string, boolean>;
    }> {
        const editCount = await db.edits.count();
        const manifestCount = await db.manifests.count();
        return {
            editCount,
            manifestCount,
            locks: mutex.isLocked
        };
    }
};

// Export API for comlink
expose(editHistoryApi);

// Export types for TypeScript consumers
export type { StoredEdit, StoredManifest, StorageType };
export { ValidationError, SecurityError, StateConsistencyError };
