import { freeze, produce } from 'immer';
import { db } from '@/workers/edit-history/database';
import { CONFIG } from '@/workers/edit-history/config';
import { ValidationError, StateConsistencyError, IntegrityError, ConcurrencyError } from '@/workers/edit-history/errors';
import { sleep } from '@/workers/edit-history/utils';
import {
    HashService,
    CompressionService,
    DiffService,
    ReconstructionService,
    ContextService,
    ManifestService
} from '@/workers/edit-history/services';
import type { NoteManifest } from '@/types';
import type { StoredEdit, StorageType, CreateStoredEdit } from '@/workers/edit-history/types';

export class EditStorageService {
    private static readonly MAX_TRANSACTION_RETRIES = 5;

    static async saveEdit(
        noteId: string,
        branchName: string,
        editId: string,
        contentStr: string,
        manifest: NoteManifest,
        options: { force?: boolean } = {}
    ): Promise<{ size: number; contentHash: string }> {
        const contentHash = await HashService.computeHash(contentStr);
        const uncompressedSize = CompressionService.getUncompressedSize(contentStr);

        const maxChainLength = this.calculateMaxChainLength(uncompressedSize);

        for (let attempt = 0; attempt < this.MAX_TRANSACTION_RETRIES; attempt++) {
            // 1. Idempotency Check: If edit ID exists, return existing stats
            if (!options.force) {
                const existing = await this.getExistingEdit(noteId, branchName, editId);
                if (existing) {
                    return { size: existing.size, contentHash: existing.contentHash };
                }
            }

            // 2. Context Retrieval with Strict Freshness
            let previousContext = null;
            try {
                previousContext = await ContextService.getPreviousEditContext(noteId, branchName);
            } catch (error) {
                console.warn(`[EditStorageService] Failed to retrieve context for ${noteId}:${branchName}, forcing full save.`, error);
            }

            // 3. Determine Storage Strategy (Full vs Diff)
            const { compressedContent, storageType, baseEditId, previousEditId, chainLength } =
                await this.determineStorageStrategy(
                    contentStr,
                    uncompressedSize,
                    maxChainLength,
                    previousContext,
                    editId
                );

            const editRecord = this.createEditRecord({
                noteId,
                branchName,
                editId,
                content: compressedContent,
                contentHash,
                storageType,
                chainLength,
                uncompressedSize,
                ...(baseEditId !== undefined ? { baseEditId } : {}),
                ...(previousEditId !== undefined ? { previousEditId } : {})
            });

            const updatedManifest = ManifestService.updateManifestWithEditInfo(
                manifest,
                branchName,
                editId,
                compressedContent.byteLength,
                uncompressedSize,
                contentHash
            );

            try {
                // 4. Execute Atomic Transaction via Resilient Wrapper
                const committed = await db.execute(async () => {
                    return await this.executeSaveTransaction(
                        noteId,
                        branchName,
                        editId,
                        editRecord,
                        updatedManifest,
                        previousContext?.editId,
                        options.force
                    );
                }, 'saveEdit');

                if (committed) {
                    ContextService.clearCache(noteId, branchName);
                    return { size: compressedContent.byteLength, contentHash };
                }
            } catch (error) {
                if (error instanceof ConcurrencyError) {
                    console.warn(`[EditStorageService] Concurrency conflict (head moved), retrying... Attempt ${attempt + 1}`);
                } else if (attempt === this.MAX_TRANSACTION_RETRIES - 1) {
                    throw error;
                }
            }

            if (attempt < this.MAX_TRANSACTION_RETRIES - 1) {
                await sleep(CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
            }
        }

        throw new StateConsistencyError(
            'Failed to save edit after maximum retries',
            { noteId, branchName, editId }
        );
    }

    static async getEditContent(
        noteId: string,
        branchName: string,
        editId: string
    ): Promise<ArrayBuffer | null> {
        return db.execute(async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([noteId, branchName])
                .toArray();

            const editMap = new Map(edits.map((e) => [e.editId, e]));

            if (!editMap.has(editId)) {
                return null;
            }

            try {
                const result = await ReconstructionService.reconstructFromMap(editId, editMap, true);
                return CompressionService.textEncoder.encode(result.content).buffer as ArrayBuffer;
            } catch (error) {
                throw new IntegrityError(
                    `Failed to reconstruct edit ${editId}`,
                    '', 
                    error instanceof Error ? error.message : 'Unknown error',
                    'error'
                );
            }
        }, 'getEditContent');
    }

    static async deleteEdit(
        noteId: string,
        branchName: string,
        editId: string
    ): Promise<void> {
        await db.execute(async () => {
            await db.transaction('rw', db.edits, async () => {
                const branchEdits = await db.edits
                    .where('[noteId+branchName]')
                    .equals([noteId, branchName])
                    .toArray();

                const editMap = new Map(branchEdits.map((e) => [e.editId, e]));
                const targetEdit = editMap.get(editId);

                if (!targetEdit) {
                    return;
                }

                await this.handleEditDeletion(targetEdit, branchEdits, editMap);
                ContextService.clearCache(noteId, branchName);
            });
        }, 'deleteEdit');
    }

    static async renameEdit(
        noteId: string,
        oldEditId: string,
        newEditId: string
    ): Promise<void> {
        if (oldEditId === newEditId) return;

        await db.execute(async () => {
            await db.transaction('rw', db.edits, async () => {
                const oldExists = await this.checkEditExistsById(noteId, oldEditId);
                if (!oldExists) return;

                const newExists = await this.checkEditExistsById(noteId, newEditId);
                if (newExists) {
                    throw new ValidationError(`Edit ${newEditId} already exists`, 'newEditId');
                }

                await this.renameEditRecords(noteId, oldEditId, newEditId);
                await this.updateDependentRecords(noteId, oldEditId, newEditId);
            });
        }, 'renameEdit');
    }

    private static async getExistingEdit(
        noteId: string,
        branchName: string,
        editId: string
    ): Promise<StoredEdit | undefined> {
        return db.execute(async () => {
            return await db.edits
                .where('[noteId+branchName+editId]')
                .equals([noteId, branchName, editId])
                .first();
        }, 'getExistingEdit');
    }

    private static async checkEditExistsById(noteId: string, editId: string): Promise<boolean> {
        const count = await db.edits
            .where({ noteId, editId })
            .count();
        return count > 0;
    }

    private static calculateMaxChainLength(uncompressedSize: number): number {
        if (uncompressedSize > CONFIG.CHAIN_THRESHOLDS.MEDIUM_SIZE_LIMIT) {
            return CONFIG.CHAIN_THRESHOLDS.LARGE_CHAIN_LENGTH;
        } else if (uncompressedSize > CONFIG.CHAIN_THRESHOLDS.SMALL_SIZE_LIMIT) {
            return CONFIG.CHAIN_THRESHOLDS.MEDIUM_CHAIN_LENGTH;
        }
        return CONFIG.CHAIN_THRESHOLDS.SMALL_CHAIN_LENGTH;
    }

    private static async determineStorageStrategy(
        contentStr: string,
        uncompressedSize: number,
        maxChainLength: number,
        previousContext: any,
        editId: string
    ) {
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
            const isChainTooLong = previousContext.chainLength >= maxChainLength;

            if (isChainTooLong) {
                compressedContent = CompressionService.compressContent(contentStr);
                storageType = 'full';
                chainLength = 0;
                previousEditId = previousContext.editId;
            } else {
                const diffPatch = DiffService.createDiff(previousContext.content, contentStr, editId);
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

        return { compressedContent, storageType, baseEditId, previousEditId, chainLength };
    }

    private static async executeSaveTransaction(
        noteId: string,
        branchName: string,
        editId: string,
        editRecord: CreateStoredEdit,
        updatedManifest: NoteManifest,
        expectedPreviousId?: string,
        force: boolean = false
    ): Promise<boolean> {
        let committed = false;

        await db.transaction('rw', db.edits, db.manifests, async () => {
            // 1. Double-check existence inside transaction
            const existing = await db.edits
                .where('[noteId+branchName+editId]')
                .equals([noteId, branchName, editId])
                .first();

            if (existing) {
                if (!force) {
                    committed = true; // Idempotent success
                    return;
                }
                // If forcing, we overwrite. Preserve internal ID.
                if (existing.id) {
                    // @ts-ignore
                    editRecord.id = existing.id;
                }
            }

            // 2. Strict Head Validation
            if (!force && !existing) {
                const currentHead = await db.edits
                    .where('[noteId+branchName]')
                    .equals([noteId, branchName])
                    .last();

                if (expectedPreviousId && currentHead?.editId !== expectedPreviousId) {
                    throw new ConcurrencyError(
                        'Head moved during save transaction',
                        'head_mismatch',
                        'edits'
                    );
                }
                
                if (!expectedPreviousId && currentHead) {
                     throw new ConcurrencyError(
                        'Head exists but expected none (initialization conflict)',
                        'head_mismatch',
                        'edits'
                    );
                }
            }

            // 3. Commit
            await db.edits.put({ ...editRecord } as StoredEdit);
            await db.manifests.put({
                noteId,
                manifest: updatedManifest,
                updatedAt: Date.now()
            });

            committed = true;
        });

        return committed;
    }

    private static async handleEditDeletion(
        targetEdit: StoredEdit,
        branchEdits: StoredEdit[],
        editMap: Map<string, StoredEdit>
    ): Promise<void> {
        const children = branchEdits.filter((e) => e.previousEditId === targetEdit.editId);
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
                
                if (targetEdit.previousEditId !== undefined) {
                    draft.previousEditId = targetEdit.previousEditId;
                } else {
                    delete draft.previousEditId;
                }
                
                draft.updatedAt = Date.now();
            });

            updates.push(updatedChild);
            await this.updateDescendants(child, branchEdits, updates);
        }

        if (updates.length > 0) {
            await db.edits.bulkPut(updates.map((u) => ({ ...u })));
        }

        if (targetEdit.id !== undefined) {
            await db.edits.delete(targetEdit.id);
        }
    }

    private static async updateDescendants(
        parent: StoredEdit,
        branchEdits: StoredEdit[],
        updates: StoredEdit[]
    ): Promise<void> {
        const queue = [parent.editId];
        const visited = new Set([parent.editId]);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const descendants = branchEdits.filter((e) => e.previousEditId === currentId);

            for (const descendant of descendants) {
                if (!visited.has(descendant.editId)) {
                    if (descendant.storageType === 'full') {
                        continue;
                    }

                    visited.add(descendant.editId);
                    queue.push(descendant.editId);

                    const parentUpdate = updates.find((u) => u.editId === descendant.previousEditId);
                    const parentRecord = parentUpdate || branchEdits.find(e => e.editId === descendant.previousEditId);
                    const newChainLength = parentRecord ? parentRecord.chainLength + 1 : 1;

                    const updatedDescendant = produce(descendant, (draft) => {
                        draft.baseEditId = parent.editId;
                        draft.chainLength = newChainLength;
                        draft.updatedAt = Date.now();
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

    private static async renameEditRecords(
        noteId: string,
        oldEditId: string,
        newEditId: string
    ): Promise<void> {
        const records = await db.edits
            .where('noteId')
            .equals(noteId)
            .filter((e) => e.editId === oldEditId)
            .toArray();

        for (const record of records) {
            if (record.id !== undefined) {
                await db.edits.update(record.id, { 
                    editId: newEditId,
                    updatedAt: Date.now()
                });
            }
        }
    }

    private static async updateDependentRecords(
        noteId: string,
        oldEditId: string,
        newEditId: string
    ): Promise<void> {
        const dependentRecords = await db.edits
            .where('noteId')
            .equals(noteId)
            .filter((e) => e.baseEditId === oldEditId || e.previousEditId === oldEditId)
            .toArray();

        for (const record of dependentRecords) {
            if (record.id !== undefined) {
                const updates: Record<string, any> = {
                    updatedAt: Date.now()
                };
                
                if (record.baseEditId === oldEditId) {
                    updates['baseEditId'] = newEditId;
                }
                
                if (record.previousEditId === oldEditId) {
                    updates['previousEditId'] = newEditId;
                }
                
                if (Object.keys(updates).length > 1) {
                    await db.edits.update(record.id, updates);
                }
            }
        }
    }

    private static createEditRecord(params: {
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
    }): CreateStoredEdit {
        const chainLength = params.storageType === 'full' ? 0 : params.chainLength;

        return freeze({
            noteId: params.noteId,
            branchName: params.branchName,
            editId: params.editId,
            content: params.content,
            contentHash: params.contentHash,
            storageType: params.storageType,
            chainLength: chainLength,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            size: params.content.byteLength,
            uncompressedSize: params.uncompressedSize,
            ...(params.baseEditId !== undefined && { baseEditId: params.baseEditId }),
            ...(params.previousEditId !== undefined && { previousEditId: params.previousEditId })
        });
    }
}
