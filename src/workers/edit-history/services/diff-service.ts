import DiffMatchPatch from 'diff-match-patch';
import { applyPatch, parsePatch } from 'diff';
import { strToU8 } from 'fflate';
import { StateConsistencyError, ValidationError } from '@/workers/edit-history/errors';

export class DiffService {
    private static readonly MAX_DIFF_SIZE = 10 * 1024 * 1024;

    static createDiff(oldContent: string, newContent: string, _editId: string): string {
        if (oldContent === newContent) {
            throw new ValidationError('Content unchanged', 'content');
        }

        if (oldContent.length > this.MAX_DIFF_SIZE || newContent.length > this.MAX_DIFF_SIZE) {
            throw new ValidationError(
                `Content size exceeds maximum ${this.MAX_DIFF_SIZE}`,
                'content'
            );
        }

        try {
            const dmp = new DiffMatchPatch();
            const patches = dmp.patch_make(oldContent, newContent);
            const patchText = dmp.patch_toText(patches);

            if (!patchText) {
                // This might happen if content is identical but strict check failed?
                // Or if patch_make failed silently.
                // Re-check equality just in case dmp returns empty for identical.
                if (oldContent === newContent) return '';
                throw new StateConsistencyError('Generated patch is empty');
            }

            return patchText;
        } catch (error) {
            if (error instanceof ValidationError || error instanceof StateConsistencyError) {
                throw error;
            }
            
            const message = error instanceof Error ? error.message : 'Unknown diff creation error';
            throw new StateConsistencyError(`Diff creation failed: ${message}`);
        }
    }

    static applyDiff(baseContent: string, patch: string): string {
        if (!patch.trim()) {
            throw new ValidationError('Patch is empty', 'patch');
        }

        // Strategy 1: Diff-Match-Patch (Primary)
        try {
            const dmp = new DiffMatchPatch();
            const patches = dmp.patch_fromText(patch);
            
            if (patches.length > 0) {
                const [newText, results] = dmp.patch_apply(patches, baseContent);

                // Verify application success
                // results is an array of booleans indicating success of each patch
                if (results.every(success => success)) {
                    return newText;
                }
                // If partial failure, fall through to fallback
            }
        } catch (error) {
            // Ignore DMP errors to try fallback
        }

        // Strategy 2: 'diff' library (Fallback for legacy/unified diffs)
        try {
            const result = applyPatch(baseContent, patch);
            if (typeof result === 'string') {
                return result;
            }
        } catch (error) {
            // Ignore fallback errors
        }

        // Failure: Both strategies failed
        throw new StateConsistencyError(
            'Patch application failed',
            { 
                reason: 'Both DMP and legacy diff application strategies failed'
            }
        );
    }

    static calculateDiffSize(diffPatch: string): number {
        return strToU8(diffPatch).length;
    }

    static validatePatch(patch: string): boolean {
        if (!patch || patch.trim().length === 0) {
            return false;
        }

        // Check DMP
        try {
            const dmp = new DiffMatchPatch();
            const patches = dmp.patch_fromText(patch);
            if (patches.length > 0) return true;
        } catch {
            // Ignore
        }

        // Check Fallback (Unified Diff)
        try {
            const parsed = parsePatch(patch);
            return parsed.length > 0;
        } catch {
            return false;
        }
    }

    static canApplyDiff(baseContent: string, patch: string): boolean {
        // Strategy 1: DMP
        try {
            const dmp = new DiffMatchPatch();
            const patches = dmp.patch_fromText(patch);
            if (patches.length > 0) {
                const [_newText, results] = dmp.patch_apply(patches, baseContent);
                if (results.every(success => success)) return true;
            }
        } catch {
            // Ignore
        }

        // Strategy 2: Fallback
        try {
            const result = applyPatch(baseContent, patch);
            return typeof result === 'string';
        } catch {
            return false;
        }
    }

    static createMinimalDiff(oldContent: string, newContent: string): string {
        // Alias to createDiff as dmp.patch_make is already efficient and minimal.
        // We ignore editId here as it's not strictly required for patch generation in dmp.
        return this.createDiff(oldContent, newContent, 'minimal');
    }
}
