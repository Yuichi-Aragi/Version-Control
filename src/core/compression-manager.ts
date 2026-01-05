import type { CompressionWorkerApi } from '@/types';
import { WorkerManager } from '@/workers';

// Injected by esbuild define
declare const compressionWorkerString: string;

/**
 * Manages the lifecycle and interface of the Compression Worker.
 * Uses WorkerManager for unified worker lifecycle management.
 */
export class CompressionManager {
    private readonly workerManager: WorkerManager<CompressionWorkerApi>;

    constructor() {
        this.workerManager = new WorkerManager<CompressionWorkerApi>({
            workerString: typeof compressionWorkerString !== 'undefined' ? compressionWorkerString : '',
            workerName: 'Compression Worker',
            validateOnInit: false,
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    public initialize(): void {
        this.workerManager.initialize();
    }

    public async compress(content: string | ArrayBuffer, level = 9): Promise<ArrayBuffer> {
        return this.workerManager.execute(
            (api) => api.compress(content, level),
            { timeout: 10000, retry: true }
        );
    }

    public async decompress(content: ArrayBuffer): Promise<string> {
        return this.workerManager.execute(
            (api) => api.decompress(content),
            { timeout: 10000, retry: true }
        );
    }

    public async createZip(files: Record<string, string | ArrayBuffer>, level = 9): Promise<ArrayBuffer> {
        return this.workerManager.execute(
            (api) => api.createZip(files, level),
            { timeout: 30000, retry: true } // Longer timeout for zip operations
        );
    }

    public terminate(): void {
        this.workerManager.terminate();
    }

    public getStatus() {
        return this.workerManager.getStatus();
    }

    public isHealthy(): boolean {
        return this.workerManager.isHealthy();
    }
}
