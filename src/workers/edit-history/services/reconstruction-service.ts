import { freeze } from 'immer';
import { 
    ValidationError, 
    StateConsistencyError, 
    IntegrityError,
    CircularReferenceError,
    ChainLengthError,
    MissingEditError,
    BrokenChainError,
    ReconstructionError
} from '@/workers/edit-history/errors';
import { HashService } from '@/workers/edit-history/services/hash-service';
import { CompressionService } from '@/workers/edit-history/services/compression-service';
import { DiffService } from '@/workers/edit-history/services/diff-service';
import type { StoredEdit, ReconstructionResult, ChainValidationResult } from '@/workers/edit-history/types';

export class ReconstructionService {
    private static readonly MAX_CHAIN_LENGTH = 1000;
    
    // LRU Cache for reconstruction results.
    // Validity is strictly enforced by checking the cached hash against the requested record's hash.
    private static readonly cache = new Map<string, ReconstructionResult>();
    private static readonly MAX_CACHE_SIZE = 50;

    static async reconstructFromMap(
        targetEditId: string,
        editMap: Map<string, StoredEdit>,
        verify: boolean = true
    ): Promise<ReconstructionResult> {
        // Input validation
        if (typeof targetEditId !== 'string' || targetEditId.trim().length === 0) {
            throw new ValidationError(
                'targetEditId must be a non-empty string',
                'targetEditId',
                { value: targetEditId, type: typeof targetEditId }
            );
        }
        
        if (!(editMap instanceof Map)) {
            throw new ValidationError(
                'editMap must be a Map instance',
                'editMap',
                { type: (editMap as any)?.constructor?.name }
            );
        }
        
        if (editMap.size === 0) {
            throw new ValidationError('editMap cannot be empty', 'editMap', { size: 0 });
        }

        // Get target edit
        const target = editMap.get(targetEditId);
        if (!target) {
            throw new ValidationError(
                `Target edit ${targetEditId} not found`,
                'targetEditId',
                { 
                    targetEditId,
                    availableIds: Array.from(editMap.keys()).slice(0, 10),
                    totalEdits: editMap.size
                }
            );
        }

        // CACHE CHECK
        // We only use the cache if the target record has a hash to validate against.
        // This ensures we never serve stale content if the record has been updated.
        if (target.contentHash) {
            const cached = this.cache.get(targetEditId);
            if (cached && cached.hash === target.contentHash) {
                // Cache Hit: Refresh LRU position
                this.cache.delete(targetEditId);
                this.cache.set(targetEditId, cached);
                return cached;
            }
        }

        // Build chain with circular reference detection
        const chain = this.buildChain(targetEditId, editMap);
        
        // Validate chain length
        if (chain.length > this.MAX_CHAIN_LENGTH) {
            throw new ChainLengthError(
                `Chain length ${chain.length} exceeds maximum ${this.MAX_CHAIN_LENGTH}`,
                { targetEditId, chainLength: chain.length, maxLength: this.MAX_CHAIN_LENGTH }
            );
        }

        // Reconstruct content
        const content = await this.applyChain(chain);
        
        // Compute hash
        const hash = await HashService.computeHash(content);

        // Verify integrity if requested
        let verified = true;
        if (verify && target.contentHash && target.contentHash.length > 0) {
            verified = hash === target.contentHash;
            if (!verified) {
                throw new IntegrityError(
                    `Content integrity check failed for edit ${targetEditId}`,
                    target.contentHash,
                    hash,
                    { editId: target.editId, chainLength: chain.length }
                );
            }
        }

        const result = freeze({ 
            content, 
            hash, 
            verified,
            chainLength: chain.length,
            reconstructionTime: Date.now()
        });

        // CACHE UPDATE
        // Only cache if we have a valid hash to verify against later
        if (target.contentHash && target.contentHash === hash) {
            this.updateCache(targetEditId, result);
        }

        return result;
    }

    static async reconstructBatch(
        editIds: string[],
        editMap: Map<string, StoredEdit>,
        verify: boolean = true
    ): Promise<ReconstructionResult[]> {
        // Input validation
        if (!Array.isArray(editIds)) {
            throw new ValidationError('editIds must be an array', 'editIds', { type: typeof editIds });
        }
        
        if (editIds.length === 0) {
            return freeze([]);
        }
        
        if (!(editMap instanceof Map)) {
            throw new ValidationError(
                'editMap must be a Map instance',
                'editMap',
                { type: (editMap as any)?.constructor?.name }
            );
        }

        // Validate all edit IDs exist before processing
        const missingIds: string[] = [];
        for (const editId of editIds) {
            if (!editMap.has(editId)) {
                missingIds.push(editId);
            }
        }
        
        if (missingIds.length > 0) {
            throw new ValidationError(
                `Missing edit IDs in batch: ${missingIds.slice(0, 5).join(', ')}${missingIds.length > 5 ? '...' : ''}`,
                'editIds',
                { missingIds: missingIds.slice(0, 10), totalMissing: missingIds.length }
            );
        }

        // Sequential reconstruction for guaranteed order and error isolation
        const results: ReconstructionResult[] = [];
        
        for (let i = 0; i < editIds.length; i++) {
            const editId = editIds[i];
            
            if (editId === undefined) continue;
            
            try {
                const result = await this.reconstructFromMap(editId, editMap, verify);
                results.push(result);
            } catch (error) {
                throw new StateConsistencyError(
                    `Failed to reconstruct edit at index ${i}: ${editId}`,
                    { 
                        index: i,
                        editId,
                        successfulReconstructions: results.length,
                        totalInBatch: editIds.length,
                        originalError: error instanceof Error ? error : new Error(String(error))
                    }
                );
            }
        }
        
        return freeze(results);
    }

    static async validateChain(
        editId: string,
        editMap: Map<string, StoredEdit>
    ): Promise<ChainValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        const diagnostics: Record<string, unknown> = {};
        
        try {
            // Input validation
            if (typeof editId !== 'string' || editId.trim().length === 0) {
                errors.push('editId must be a non-empty string');
            }
            
            if (!(editMap instanceof Map)) {
                errors.push('editMap must be a Map instance');
            }
            
            if (errors.length > 0) {
                return freeze({
                    valid: false,
                    chainLength: 0,
                    hasBase: false,
                    isComplete: false,
                    errors,
                    warnings,
                    diagnostics: freeze(diagnostics)
                });
            }
            
            // Build chain
            const chain = this.buildChain(editId, editMap);
            const hasBase = chain.some(e => e?.storageType === 'full');
            const isComplete = this.isChainComplete(chain);
            
            diagnostics['chainLength'] = chain.length;
            diagnostics['hasBase'] = hasBase;
            diagnostics['isComplete'] = isComplete;
            diagnostics['chainEditIds'] = chain.map(e => e?.editId).filter(Boolean);
            
            // Chain validation
            if (!hasBase) {
                errors.push('Chain missing base (full) edit - cannot reconstruct from diffs only');
            }
            
            if (chain.length > this.MAX_CHAIN_LENGTH) {
                errors.push(`Chain length ${chain.length} exceeds maximum ${this.MAX_CHAIN_LENGTH}`);
            }
            
            if (!isComplete) {
                errors.push('Chain is incomplete - missing intermediate edits');
            }
            
            // Individual edit validation
            for (let i = 0; i < chain.length; i++) {
                const edit = chain[i];
                if (!edit) {
                    errors.push(`Missing edit at chain position ${i}`);
                    continue;
                }
                
                if (edit.storageType === 'diff' && !edit.previousEditId) {
                    errors.push(`Diff edit ${edit.editId} missing previousEditId at position ${i}`);
                }
                
                if (edit.storageType === 'full' && edit.previousEditId && i !== chain.length - 1) {
                    // This warning is technically valid but we now tolerate multiple full edits.
                    // However, buildChain stops at the first full edit, so 'i' should be chain.length-1.
                    // If we have full edits earlier in the chain (closer to target), it means buildChain didn't stop?
                    // No, buildChain stops at full. So this condition implies the full edit is NOT at the end.
                    // Which contradicts buildChain logic. Keeping as warning for anomaly detection.
                    warnings.push(`Full edit ${edit.editId} has previousEditId but is not at chain end (anomaly)`);
                }
                
                if (edit.contentHash && edit.contentHash.length !== 64) {
                    warnings.push(`Edit ${edit.editId} has non-standard hash length: ${edit.contentHash.length}`);
                }
            }
            
            // Performance warnings
            if (chain.length > 100) {
                warnings.push(`Long chain detected (${chain.length} edits) - reconstruction may be slow`);
            }
            
            // Test reconstruction if no critical errors
            if (errors.length === 0) {
                try {
                    await this.reconstructFromMap(editId, editMap, false);
                    diagnostics['testReconstruction'] = 'success';
                } catch (reconError) {
                    errors.push(`Test reconstruction failed: ${reconError instanceof Error ? reconError.message : 'Unknown error'}`);
                    diagnostics['testReconstruction'] = 'failed';
                    diagnostics['reconstructionError'] = reconError instanceof Error ? reconError.message : String(reconError);
                }
            }
            
            return freeze({
                valid: errors.length === 0,
                chainLength: chain.length,
                hasBase,
                isComplete,
                errors: freeze(errors),
                warnings: freeze(warnings),
                diagnostics: freeze(diagnostics)
            });
            
        } catch (error) {
            errors.push(error instanceof Error ? error.message : 'Unknown chain validation error');
            diagnostics['validationError'] = error instanceof Error ? error.stack : String(error);
            
            return freeze({
                valid: false,
                chainLength: 0,
                hasBase: false,
                isComplete: false,
                errors: freeze(errors),
                warnings: freeze(warnings),
                diagnostics: freeze(diagnostics)
            });
        }
    }

    static clearCache(): void {
        this.cache.clear();
    }

    private static updateCache(key: string, result: ReconstructionResult): void {
        this.cache.delete(key);
        
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        
        this.cache.set(key, result);
    }

    private static buildChain(
        targetEditId: string,
        editMap: Map<string, StoredEdit>
    ): readonly StoredEdit[] {
        const chain: StoredEdit[] = [];
        const visited = new Set<string>();
        let currentId: string | undefined = targetEditId;

        while (currentId !== undefined) {
            // Circular reference detection
            if (visited.has(currentId)) {
                throw new CircularReferenceError(
                    `Circular reference detected at ${currentId}`,
                    { currentId, visited: Array.from(visited) }
                );
            }
            visited.add(currentId);

            // Get edit record
            const record = editMap.get(currentId);
            if (!record) {
                throw new MissingEditError(
                    `Missing edit record in chain: ${currentId}`,
                    { currentId, availableIds: Array.from(editMap.keys()).slice(0, 5) }
                );
            }

            chain.push(record);

            // Stop at full edit
            if (record.storageType === 'full') {
                break;
            }

            // Handle diff edits
            currentId = record.previousEditId;

            if (currentId === undefined && record.storageType === 'diff') {
                throw new BrokenChainError(
                    `Broken chain: diff ${record.editId} missing previousEditId`,
                    { editId: record.editId, storageType: record.storageType }
                );
            }
        }

        return freeze(chain);
    }

    private static async applyChain(chain: readonly StoredEdit[]): Promise<string> {
        if (chain.length === 0) {
            throw new ReconstructionError('Empty chain - no records to apply', { chainLength: 0 });
        }

        // Reverse chain for forward application
        const reversed = [...chain].reverse();
        const baseRecord = reversed[0];
        
        if (!baseRecord) {
            throw new ReconstructionError('No base record in chain', { chainLength: chain.length });
        }

        if (baseRecord.storageType !== 'full') {
            throw new StateConsistencyError(
                'Base record must be of storageType "full"',
                { editId: baseRecord.editId, storageType: baseRecord.storageType }
            );
        }

        // Decompress base content
        let content = await CompressionService.decompress(baseRecord);

        // Apply diffs sequentially
        for (let i = 1; i < reversed.length; i++) {
            const edit = reversed[i];
            if (!edit) continue;
            
            // ROBUSTNESS: Tolerate multiple full edits in chain.
            // If we encounter a full edit in the middle of the chain, it acts as a new base.
            // This handles cases where chain optimization or recovery inserted full edits unexpectedly.
            if (edit.storageType === 'full') {
                content = await CompressionService.decompress(edit);
                continue;
            }
            
            if (edit.storageType !== 'diff') {
                continue;
            }
            
            try {
                const patch = await CompressionService.decompress(edit);
                content = DiffService.applyDiff(content, patch);
                
                // Optional intermediate hash verification
                if (edit.contentHash) {
                    const intermediateHash = await HashService.computeHash(content);
                    if (intermediateHash !== edit.contentHash) {
                        throw new IntegrityError(
                            `Intermediate integrity check failed at position ${i}`,
                            edit.contentHash,
                            intermediateHash,
                            { editId: edit.editId, chainPosition: i }
                        );
                    }
                }
            } catch (error) {
                throw new ReconstructionError(
                    `Failed to apply diff at position ${i}`,
                    { 
                        editId: edit.editId,
                        chainPosition: i,
                        chainLength: reversed.length,
                        originalError: error instanceof Error ? error : new Error(String(error))
                    }
                );
            }
        }

        return content;
    }

    static async attemptRepair(
        targetEditId: string,
        editMap: Map<string, StoredEdit>
    ): Promise<ReconstructionResult | null> {
        // Validate input
        if (!editMap.has(targetEditId)) {
            return null;
        }
        
        const target = editMap.get(targetEditId);
        if (!target) {
            return null;
        }

        try {
            // First try to reconstruct normally
            return await this.reconstructFromMap(targetEditId, editMap, true);
        } catch {
            // Try to find the nearest valid chain by walking backwards
            let currentId = target.previousEditId;
            const visited = new Set<string>();
            
            while (currentId && !visited.has(currentId)) {
                visited.add(currentId);
                
                try {
                    const result = await this.reconstructFromMap(currentId, editMap, true);
                    return freeze({
                        ...result,
                        repairedFrom: currentId,
                        note: 'Repaired from nearest valid edit'
                    });
                } catch {
                    const edit = editMap.get(currentId);
                    currentId = edit?.previousEditId;
                }
            }

            // Try to reconstruct from base if chain is broken
            try {
                const chain = this.buildChain(targetEditId, editMap);
                const baseEdit = chain.find(e => e?.storageType === 'full');
                
                if (baseEdit) {
                    const baseResult = await this.reconstructFromMap(baseEdit.editId, editMap, true);
                    return freeze({
                        ...baseResult,
                        repairedFrom: baseEdit.editId,
                        note: 'Reconstructed from base only - diffs may be missing'
                    });
                }
            } catch {
                // Base reconstruction failed
            }

            return null;
        }
    }

    private static isChainComplete(chain: readonly StoredEdit[]): boolean {
        if (chain.length === 0) {
            return false;
        }
        
        // Check for gaps in the chain
        for (let i = 0; i < chain.length - 1; i++) {
            const current = chain[i];
            const next = chain[i + 1];
            
            if (current?.storageType === 'diff' && current.previousEditId !== next?.editId) {
                return false;
            }
        }
        
        // Ensure last edit is a full edit
        const lastEdit = chain[chain.length - 1];
        return lastEdit?.storageType === 'full';
    }
}
