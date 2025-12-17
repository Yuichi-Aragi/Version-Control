import { freeze } from 'immer';
import { db } from '@/workers/edit-history/database';
import { ReconstructionService } from '@/workers/edit-history/services/reconstruction-service';
import { ManifestService } from '@/workers/edit-history/services/manifest-service';
import { CompressionService } from '@/workers/edit-history/services/compression-service';
import { ValidationError } from '@/workers/edit-history/errors';
import type { IntegrityCheckResult, StoredEdit } from '@/workers/edit-history/types';

export class IntegrityService {
    private static readonly BATCH_SIZE = 50;

    static async verifyEditIntegrity(
        noteId: string,
        branchName: string,
        editId: string,
        options: { fix?: boolean } = {}
    ): Promise<IntegrityCheckResult> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        const editMap = new Map(edits.map((e) => [e.editId, e]));
        const targetEdit = editMap.get(editId);

        if (!targetEdit) {
            throw new ValidationError(`Edit ${editId} not found`, 'editId');
        }

        try {
            const result = await ReconstructionService.reconstructFromMap(editId, editMap, false);

            const actualHash = result.hash;
            const expectedHash = targetEdit.contentHash || '';
            
            let valid = false;
            
            if (expectedHash === '') {
                // If expected hash is missing, we consider it invalid unless fixed
                valid = false;
            } else if (expectedHash.length === 64) {
                valid = actualHash === expectedHash;
            }

            let wasHealed = false;

            if (!valid && options.fix) {
                // Determine if we can heal
                // We assume the reconstructed content is the "truth" if the chain is valid (which reconstructFromMap ensures)
                // We update the hash and uncompressed size in the DB and Manifest
                
                await db.transaction('rw', db.edits, db.manifests, async () => {
                    // 1. Update Edit Record
                    const currentEdit = await db.edits.get(targetEdit.id!);
                    if (currentEdit) {
                        const updates: Partial<StoredEdit> = {
                            contentHash: actualHash,
                            uncompressedSize: CompressionService.getUncompressedSize(result.content),
                            updatedAt: Date.now()
                        };
                        await db.edits.update(currentEdit.id!, updates);
                    }

                    // 2. Update Manifest
                    const manifestRecord = await db.manifests.get(noteId);
                    if (manifestRecord) {
                        const updatedManifest = ManifestService.updateManifestWithEditInfo(
                            manifestRecord.manifest,
                            branchName,
                            editId,
                            targetEdit.size, // Compressed size remains same as we didn't recompress
                            CompressionService.getUncompressedSize(result.content),
                            actualHash
                        );
                        await db.manifests.put({
                            ...manifestRecord,
                            manifest: updatedManifest,
                            updatedAt: Date.now()
                        });
                    }
                });

                valid = true;
                wasHealed = true;
            }

            return freeze({ 
                valid, 
                expectedHash, 
                actualHash,
                editId,
                noteId,
                branchName,
                verifiedAt: new Date().toISOString(),
                wasHealed
            });

        } catch (error) {
            return freeze({
                valid: false,
                expectedHash: targetEdit.contentHash || '',
                actualHash: '',
                editId,
                noteId,
                branchName,
                verifiedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async verifyBranchIntegrity(
        noteId: string,
        branchName: string,
        options: { fix?: boolean } = {}
    ): Promise<readonly IntegrityCheckResult[]> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        if (edits.length === 0) {
            return freeze([]);
        }

        const results: IntegrityCheckResult[] = [];

        // Process in batches to avoid locking the thread too long
        for (let i = 0; i < edits.length; i += this.BATCH_SIZE) {
            const batch = edits.slice(i, i + this.BATCH_SIZE);
            
            // We process sequentially within batch if fixing to avoid transaction conflicts
            if (options.fix) {
                for (const edit of batch) {
                    const result = await this.verifyEditIntegrity(noteId, branchName, edit.editId, options);
                    results.push(result);
                }
            } else {
                // Parallel verification for speed when read-only
                const batchResults = await Promise.all(
                    batch.map(edit => this.verifyEditIntegrity(noteId, branchName, edit.editId, options))
                );
                results.push(...batchResults);
            }
        }

        return freeze(results);
    }

    static async verifyAllBranches(
        noteId: string,
        options: { fix?: boolean } = {}
    ): Promise<Record<string, readonly IntegrityCheckResult[]>> {
        const edits = await db.edits.where('noteId').equals(noteId).toArray();
        const branches = new Set(edits.map(e => e.branchName));
        const results: Record<string, readonly IntegrityCheckResult[]> = {};

        for (const branchName of branches) {
            results[branchName] = await this.verifyBranchIntegrity(noteId, branchName, options);
        }

        return results;
    }

    static async findCorruptEdits(
        noteId: string,
        branchName: string
    ): Promise<string[]> {
        const results = await this.verifyBranchIntegrity(noteId, branchName);
        return results.filter(r => !r.valid).map(r => r.editId || '');
    }

    static async verifyChainConsistency(
        noteId: string,
        branchName: string
    ): Promise<boolean> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        const editMap = new Map(edits.map(e => [e.editId, e]));
        const visited = new Set<string>();

        for (const edit of edits) {
            if (edit.storageType === 'diff' && !edit.previousEditId) {
                return false;
            }

            if (edit.previousEditId && !editMap.has(edit.previousEditId)) {
                return false;
            }

            let currentId: string | undefined = edit.editId;
            while (currentId && editMap.has(currentId)) {
                if (visited.has(currentId)) {
                    return false;
                }
                visited.add(currentId);
                currentId = editMap.get(currentId)?.previousEditId;
            }
        }

        return true;
    }

    static async generateIntegrityReport(
        noteId: string
    ): Promise<{
        noteId: string;
        branchCount: number;
        editCount: number;
        corruptEdits: string[];
        chainConsistency: boolean;
        generatedAt: string;
    }> {
        const edits = await db.edits.where('noteId').equals(noteId).toArray();
        const branches = new Set(edits.map(e => e.branchName));
        
        const corruptEdits: string[] = [];
        let chainConsistency = true;

        for (const branchName of branches) {
            if (!await this.verifyChainConsistency(noteId, branchName)) {
                chainConsistency = false;
            }

            const results = await this.verifyBranchIntegrity(noteId, branchName);
            const corrupt = results.filter(r => !r.valid).map(r => r.editId || '');
            corruptEdits.push(...corrupt);
        }

        return {
            noteId,
            branchCount: branches.size,
            editCount: edits.length,
            corruptEdits,
            chainConsistency,
            generatedAt: new Date().toISOString()
        };
    }
}
