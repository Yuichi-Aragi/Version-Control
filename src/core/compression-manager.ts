import type { CompressionWorkerApi } from '@/types';
import { WorkerManager } from '@/workers';

// Injected by esbuild define
declare const compressionWorkerString: string;

/**
 * Manages the lifecycle and interface of the Compression Worker.
 * Uses WorkerManager for unified worker lifecycle management.
 * Provides methods to compress and decompress data off the main thread.
 * 
 * @example
 * ```typescript
 * const compressionManager = new CompressionManager();
 * const compressed = await compressionManager.compress(content);
 * const decompressed = await compressionManager.decompress(compressed);
 * ```
 */
export class CompressionManager {
    private readonly workerManager: WorkerManager<CompressionWorkerApi>;

    constructor() {
        // Access the global worker string (injected during build via define)
        this.workerManager = new WorkerManager<CompressionWorkerApi>({
            workerString: typeof compressionWorkerString !== 'undefined' ? compressionWorkerString : '',
            workerName: 'Compression Worker',
            validateOnInit: false, // Compression worker is simple, no validation needed
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    /**
     * Initializes the worker synchronously.
     * Safe to call multiple times - will be a no-op after first successful init.
     */
    public initialize(): void {
        this.workerManager.initialize();
    }

    /**
     * Compresses content using GZIP via the worker.
     * @param content String or ArrayBuffer to compress.
     * @param level Compression level (0-9). Default is 9.
     * @returns Promise resolving to compressed ArrayBuffer.
     * @throws Error if compression worker is unavailable
     */
    public async compress(content: string | ArrayBuffer, level = 9): Promise<ArrayBuffer> {
        const startTime = performance.now();
        try {
            const proxy = this.workerManager.ensureWorker();
            const result = await proxy.compress(content, level);
            this.workerManager.recordOperation(performance.now() - startTime);
            return result;
        } catch (error) {
            this.workerManager.recordError();
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    /**
     * Decompresses GZIP content via the worker.
     * @param content ArrayBuffer to decompress.
     * @returns Promise resolving to decompressed string.
     * @throws Error if decompression worker is unavailable
     */
    public async decompress(content: ArrayBuffer): Promise<string> {
        const startTime = performance.now();
        try {
            const proxy = this.workerManager.ensureWorker();
            const result = await proxy.decompress(content);
            this.workerManager.recordOperation(performance.now() - startTime);
            return result;
        } catch (error) {
            this.workerManager.recordError();
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    /**
     * Creates a ZIP archive from multiple files via the worker.
     * @param files Map of filename to content (string or ArrayBuffer).
     * @param level Compression level (0-9). Default is 9.
     * @returns Promise resolving to ZIP ArrayBuffer.
     * @throws Error if worker is unavailable
     */
    public async createZip(files: Record<string, string | ArrayBuffer>, level = 9): Promise<ArrayBuffer> {
        const startTime = performance.now();
        try {
            const proxy = this.workerManager.ensureWorker();
            const result = await proxy.createZip(files, level);
            this.workerManager.recordOperation(performance.now() - startTime);
            return result;
        } catch (error) {
            this.workerManager.recordError();
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    /**
     * Terminates the worker and releases all resources.
     */
    public terminate(): void {
        this.workerManager.terminate();
    }

    /**
     * Gets the current worker status for monitoring.
     * @returns Object with status information
     */
    public getStatus(): {
        isInitialized: boolean;
        isActive: boolean;
        isHealthy: boolean;
        healthStats: {
            consecutiveErrors: number;
            operationCount: number;
            averageOperationTime: number;
        };
    } {
        return this.workerManager.getStatus();
    }

    /**
     * Checks if the worker is currently healthy.
     * @returns true if worker is healthy, false otherwise
     */
    public isHealthy(): boolean {
        return this.workerManager.isHealthy();
    }
}
