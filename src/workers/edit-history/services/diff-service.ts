import { createPatch, applyPatch } from 'diff';
import { strToU8 } from 'fflate';
import { StateConsistencyError } from '@/workers/edit-history/errors';

export class DiffService {
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
