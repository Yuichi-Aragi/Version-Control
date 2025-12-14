import { injectable } from 'inversify';
import { wrap, releaseProxy, type Remote } from 'comlink';
import type { CompressionWorkerApi } from '@/types';

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
     * @param level Compression level (0-9). Default is 9.
     * @returns Promise resolving to compressed ArrayBuffer.
     */
    public async compress(content: string | ArrayBuffer, level = 9): Promise<ArrayBuffer> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) throw new Error("Compression Worker not available");

        return await this.workerProxy.compress(content, level);
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

    /**
     * Creates a ZIP archive from multiple files via the worker.
     * @param files Map of filename to content (string or ArrayBuffer).
     * @param level Compression level (0-9). Default is 9.
     * @returns Promise resolving to ZIP ArrayBuffer.
     */
    public async createZip(files: Record<string, string | ArrayBuffer>, level = 9): Promise<ArrayBuffer> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) throw new Error("Compression Worker not available");

        return await this.workerProxy.createZip(files, level);
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
