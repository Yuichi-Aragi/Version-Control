import { transfer } from 'comlink';
import { freeze, produce } from 'immer';
import { isEqual } from 'es-toolkit';
import type { NoteManifest } from '@/types';
import { CONFIG } from '@/workers/edit-history/config';
import { ValidationError, StateConsistencyError } from '@/workers/edit-history/errors';
import { db } from '@/workers/edit-history/database';
import { KeyedMutex, sleep } from '@/workers/edit-history/utils';
import {
    HashService,
    CompressionService,
    DiffService,
    ReconstructionService,
    ContextService,
    ManifestService
} from '@/workers/edit-history/services';
import {
    validateInput,
    NoteIdSchema,
    BranchNameSchema,
    EditIdSchema,
    PathSchema,
    ContentSchema,
    ManifestSchema
} from '@/workers/edit-history/validation';
import type {
    StoredEdit,
    StorageType,
    DatabaseStats,
    IntegrityCheckResult
} from '@/workers/edit-history/types';

const mutex = new KeyedMutex();

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

export const editHistoryApi = {
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

    async deleteBranch(noteId: unknown, branchName: unknown): Promise<void> {
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');

        return mutex.run(validNoteId, async () => {
            await db.transaction('rw', db.edits, db.manifests, async () => {
                // Delete all edits for this branch
                await db.edits
                    .where('[noteId+branchName]')
                    .equals([validNoteId, validBranchName])
                    .delete();

                // Update manifest to remove branch
                const record = await db.manifests.get(validNoteId);
                if (record) {
                    const updatedManifest = produce(record.manifest, (draft) => {
                        delete draft.branches[validBranchName];
                        // If current branch was the deleted one, switch to another if available
                        // This logic is primarily handled by the main thread manager, but we ensure consistency here
                        if (draft.currentBranch === validBranchName) {
                            const remainingBranches = Object.keys(draft.branches);
                            if (remainingBranches.length > 0) {
                                draft.currentBranch = remainingBranches[0]!;
                            }
                        }
                        draft.lastModified = new Date().toISOString();
                    });

                    await db.manifests.put({
                        noteId: validNoteId,
                        manifest: updatedManifest,
                        updatedAt: Date.now()
                    });
                }
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

export type EditHistoryApi = typeof editHistoryApi;
