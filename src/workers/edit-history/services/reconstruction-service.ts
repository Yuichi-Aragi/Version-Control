import { freeze } from 'immer';
import { ValidationError, StateConsistencyError, IntegrityError } from '@/workers/edit-history/errors';
import { HashService } from '@/workers/edit-history/services/hash-service';
import { CompressionService } from '@/workers/edit-history/services/compression-service';
import { DiffService } from '@/workers/edit-history/services/diff-service';
import type { StoredEdit, ReconstructionResult } from '@/workers/edit-history/types';

export class ReconstructionService {
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
