/**
 * Worker proxy management with Comlink
 */

import { wrap, releaseProxy, type Remote } from 'comlink';
import type { DiffWorkerApi } from '@/types';
import { DiffManagerError } from '@/services/diff-manager/types';

declare const diffWorkerString: string;

export class WorkerProxy {
    private worker: Worker | null = null;
    private workerProxy: Remote<DiffWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private isTerminating = false;
    private decoder = new TextDecoder('utf-8');

    async initialize(onError: (error: ErrorEvent) => void): Promise<void> {
        if (this.worker || this.isTerminating) {
            return;
        }

        try {
            if (typeof diffWorkerString === 'undefined' || diffWorkerString === '') {
                throw new DiffManagerError(
                    "Diff worker code was not injected during the build process",
                    'WORKER_CODE_MISSING'
                );
            }

            const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.worker.onerror = onError;
            this.workerProxy = wrap<DiffWorkerApi>(this.worker);
            await this.test();

        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker", error);
            this.terminate();
            throw new DiffManagerError(
                `Diff worker initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'WORKER_INIT_FAILED',
                { originalError: error }
            );
        }
    }

    private async test(): Promise<void> {
        if (!this.workerProxy) {
            throw new DiffManagerError("Worker proxy not available for testing", 'WORKER_PROXY_MISSING');
        }

        try {
            const resultBuffer = await this.workerProxy.computeDiff('lines', 'test', 'test');
            const json = this.decoder.decode(resultBuffer);
            const changes = JSON.parse(json);
            if (!Array.isArray(changes)) throw new Error("Worker returned invalid data");
        } catch (error) {
            throw new DiffManagerError(
                `Worker test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'WORKER_TEST_FAILED',
                { originalError: error }
            );
        }
    }

    terminate(): void {
        if (this.isTerminating) return;
        this.isTerminating = true;

        try {
            if (this.workerProxy) {
                this.workerProxy[releaseProxy]();
                this.workerProxy = null;
            }
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
            if (this.workerUrl) {
                URL.revokeObjectURL(this.workerUrl);
                this.workerUrl = null;
            }
        } catch (error) {
            console.error("Version Control: Error during worker termination", error);
        } finally {
            this.isTerminating = false;
        }
    }

    getProxy(): Remote<DiffWorkerApi> | null {
        return this.workerProxy;
    }

    isActive(): boolean {
        return this.workerProxy !== null && !this.isTerminating;
    }

    isInitialized(): boolean {
        return this.worker !== null;
    }
}
