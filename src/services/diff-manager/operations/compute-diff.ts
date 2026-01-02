/**
 * Diff computation operations
 * 
 * Robustness & Efficiency:
 * - Converts all string inputs to ArrayBuffer/Uint8Array to enable zero-copy Transferable usage.
 * - Manages buffer lifecycle meticulously to prevent "detached" errors during retries.
 * - Validates outputs against Valibot schemas to ensure data integrity.
 */

import { transfer, type Remote } from 'comlink';
import * as v from 'valibot';
import type { DiffWorkerApi, DiffType, Change } from '@/types';
import { ChangeSchema } from '@/schemas';
import { DiffManagerError } from '@/services/diff-manager/types';
import { MAX_RETRIES, RETRY_DELAY } from '@/services/diff-manager/config';

export class DiffComputer {
    private encoder = new TextEncoder();
    private decoder = new TextDecoder('utf-8');

    /**
     * Computes the diff with retry logic.
     * Handles the conversion of strings to ArrayBuffers for efficient transfer.
     */
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

        // --- PREPARATION: BUFFER MASTER COPIES ---
        // To enable robust retries, we must ensure the input data persists across attempts.
        // If we transfer an ArrayBuffer, it becomes detached. Therefore, we create "Master" copies
        // in memory that we can slice from for every attempt.
        
        // Optimization: If inputs are strings, convert them to ArrayBuffer once here.
        // This allows us to use zero-copy transfer for every attempt, avoiding the overhead
        // of cloning large strings repeatedly.
        let masterC1: ArrayBuffer;
        let masterC2: ArrayBuffer;

        if (content1 instanceof ArrayBuffer) {
            masterC1 = content1.slice(0); // Copy to create our persistent master
        } else {
            masterC1 = this.encoder.encode(content1).buffer.slice(0);
        }

        if (content2 instanceof ArrayBuffer) {
            masterC2 = content2.slice(0); // Copy to create our persistent master
        } else {
            masterC2 = this.encoder.encode(content2).buffer.slice(0);
        }

        // --- RETRY LOOP ---
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            let attemptBuffer1: ArrayBuffer;
            let attemptBuffer2: ArrayBuffer;
            
            try {
                // Prepare buffers for this specific attempt.
                // We slice fresh copies from the master buffers. These will be transferred (detached).
                attemptBuffer1 = masterC1.slice(0);
                attemptBuffer2 = masterC2.slice(0);

                const startTime = performance.now();

                // Execute Worker Call with Transferables
                // This is significantly faster than posting strings, as it avoids copying memory.
                const resultBuffer = await workerProxy.computeDiff(
                    diffType,
                    transfer(attemptBuffer1, [attemptBuffer1]),
                    transfer(attemptBuffer2, [attemptBuffer2])
                );

                const duration = performance.now() - startTime;
                recordOperation(duration);

                // Deserialize and Validate
                const json = this.decoder.decode(resultBuffer);
                const changes = JSON.parse(json) as Change[];

                // Validate schema to ensure data integrity (Production Grade)
                v.parse(v.array(ChangeSchema), changes);

                // Cache results if applicable
                if (version2Id !== 'current') {
                    await cacheSet(cacheKey, changes);
                }
                
                return changes;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Version Control: Diff operation attempt ${attempt} failed`, lastError);
                
                if (attempt < MAX_RETRIES) {
                    // Exponential backoff strategy
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                    
                    // If the error indicates a broken worker connection, restart it immediately
                    if (lastError.message.includes('cloned') || 
                        lastError.message.includes('terminated') || 
                        lastError.message.includes('channel closed')) {
                        await restartWorker();
                    }
                }
            }
        }

        // All retries failed
        recordError();
        throw new DiffManagerError(`Diff operation failed after ${MAX_RETRIES} attempts`, 'DIFF_OPERATION_FAILED', { originalError: lastError });
    }
}
