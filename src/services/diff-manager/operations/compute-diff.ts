/**
 * Diff computation operations
 */

import { transfer, type Remote } from 'comlink';
import * as v from 'valibot';
import type { DiffWorkerApi, DiffType, Change } from '@/types';
import { ChangeSchema } from '@/schemas';
import { DiffManagerError } from '@/services/diff-manager/types';
import { MAX_RETRIES, RETRY_DELAY } from '@/services/diff-manager/config';

export class DiffComputer {
    private decoder = new TextDecoder('utf-8');

    async compute(
        workerProxy: Remote<DiffWorkerApi>,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        diffType: DiffType,
        version2Id: string,
        cacheKey: string,
        recordOperation: (duration: number) => void,
        recordError: () => void,
        restartWorker: () => Promise<void>,
        cacheSet: (key: string, value: Change[]) => Promise<void>
    ): Promise<Change[]> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Prepare transferables for this attempt
                let c1 = content1;
                let c2 = content2;

                // We need separate transfer lists for each argument to avoid DataCloneError (duplicates in transfer list)
                // if we were to use a shared list. Comlink handles arguments individually.
                const c1Transfer: Transferable[] = [];
                const c2Transfer: Transferable[] = [];

                if (content1 instanceof ArrayBuffer) {
                    // Create a copy for this attempt so the original buffer remains available for retries
                    c1 = content1.slice(0);
                    c1Transfer.push(c1 as ArrayBuffer);
                }
                if (content2 instanceof ArrayBuffer) {
                    c2 = content2.slice(0);
                    c2Transfer.push(c2 as ArrayBuffer);
                }

                const startTime = performance.now();

                // Call worker with transfer
                // Note: transfer() expects the value as first arg, and array of transferables as second.
                // We pass distinct transfer lists for each argument to prevent ambiguity or duplication issues in Comlink.
                const resultBuffer = await workerProxy.computeDiff(
                    diffType,
                    c1Transfer.length > 0 ? transfer(c1, c1Transfer) : c1,
                    c2Transfer.length > 0 ? transfer(c2, c2Transfer) : c2
                );

                const duration = performance.now() - startTime;
                recordOperation(duration);

                // Deserialize result
                const json = this.decoder.decode(resultBuffer);
                const changes = JSON.parse(json);

                v.parse(v.array(ChangeSchema), changes);

                if (version2Id !== 'current') {
                    await cacheSet(cacheKey, changes);
                }
                return changes;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Version Control: Diff operation attempt ${attempt} failed`, lastError);
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                    if (lastError.message.includes('cloned') || lastError.message.includes('terminated')) {
                        await restartWorker();
                    }
                }
            }
        }

        recordError();
        throw new DiffManagerError(`Diff operation failed after ${MAX_RETRIES} attempts`, 'DIFF_OPERATION_FAILED', { originalError: lastError });
    }
}
