import { injectable } from 'inversify';
import { wrap, releaseProxy, type Remote } from 'comlink';
import type { CompressionWorkerApi } from '../types';

declare const compressionWorkerString: string;

/**
 * Manages the lifecycle and interface of the Compression Worker.
 * Provides methods to compress and decompress data off the main thread.
 */
@injectable()
export class CompressionManager {
    private worker: Worker | null = null;
    private workerProxy: Remote<CompressionWorkerApi> | null = null;
    private workerUrl: string | null = null;

    public initialize(): void {
        this.initializeWorker();
    }

    private initializeWorker(): void {
        if (this.worker) return;

        try {
            if (typeof compressionWorkerString === 'undefined' || compressionWorkerString === '') {
                console.error("Version Control: Compression worker code missing.");
                return;
            }
            const blob = new Blob([compressionWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.workerProxy = wrap<CompressionWorkerApi>(this.worker);
        } catch (error) {
            console.error("Version Control: Failed to initialize Compression worker", error);
        }
    }

    /**
     * Compresses content using GZIP via the worker.
     * @param content String or ArrayBuffer to compress.
     * @returns Promise resolving to compressed ArrayBuffer.
     */
    public async compress(content: string | ArrayBuffer): Promise<ArrayBuffer> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) throw new Error("Compression Worker not available");

        return await this.workerProxy.compress(content);
    }

    /**
     * Decompresses GZIP content via the worker.
     * @param content ArrayBuffer to decompress.
     * @returns Promise resolving to decompressed string.
     */
    public async decompress(content: ArrayBuffer): Promise<string> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) throw new Error("Compression Worker not available");

        return await this.workerProxy.decompress(content);
    }

    public terminate(): void {
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
    }
}
