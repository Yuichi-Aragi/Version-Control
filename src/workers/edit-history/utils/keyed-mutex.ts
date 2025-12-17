import { freeze } from 'immer';

// ============================================================================
// TYPES
// ============================================================================

interface QueuedOperation<T> {
    readonly keys: readonly string[];
    readonly execute: () => Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
    readonly enqueuedAt: number;
    readonly priority: number;
    readonly id: string;
}

class MutexTimeoutError extends Error {
    constructor(keys: readonly string[], timeoutMs: number, operationId: string) {
        super(`Mutex operation ${operationId} timed out after ${timeoutMs}ms for keys: ${keys.join(', ')}`);
        this.name = 'MutexTimeoutError';
        Object.freeze(this);
    }
}

// ============================================================================
// ENHANCED FIFO KEYED MUTEX WITH PRIORITY QUEUING
// ============================================================================

export class FifoKeyedMutex {
    private readonly queue: QueuedOperation<unknown>[] = [];
    private readonly heldKeys = new Set<string>();
    private readonly defaultTimeoutMs: number;
    private isProcessing = false;
    private operationCounter = 0;

    constructor(defaultTimeoutMs: number = 30000) {
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    async run<T>(
        key: string,
        operation: () => Promise<T>,
        timeoutMs?: number,
        priority: number = 0
    ): Promise<T> {
        return this.runMultiple([key], operation, timeoutMs, priority);
    }

    async runMultiple<T>(
        keys: readonly string[],
        operation: () => Promise<T>,
        timeoutMs: number = this.defaultTimeoutMs,
        priority: number = 0
    ): Promise<T> {
        const normalizedKeys = freeze(
            [...new Set(keys)].filter(k => k.length > 0).sort()
        );

        if (normalizedKeys.length === 0) {
            return operation();
        }

        return new Promise<T>((resolve, reject) => {
            const operationId = `op_${++this.operationCounter}`;
            const enqueuedAt = Date.now();
            
            const timeoutId = setTimeout(() => {
                const index = this.queue.findIndex(op => (op as QueuedOperation<T>).id === operationId);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    reject(new MutexTimeoutError(normalizedKeys, timeoutMs, operationId));
                }
            }, timeoutMs);

            const wrappedOperation: QueuedOperation<T> = {
                keys: normalizedKeys,
                execute: async (): Promise<T> => {
                    clearTimeout(timeoutId);
                    return operation();
                },
                resolve,
                reject,
                enqueuedAt,
                priority,
                id: operationId
            };

            this.enqueueOperation(wrappedOperation as QueuedOperation<unknown>);
            this.processQueue();
        });
    }

    private enqueueOperation(operation: QueuedOperation<unknown>): void {
        const index = this.queue.findIndex(op => op.priority > operation.priority);
        if (index === -1) {
            this.queue.push(operation);
        } else {
            this.queue.splice(index, 0, operation);
        }
    }

    private processQueue(): void {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            this.processNextOperation();
        } finally {
            this.isProcessing = false;
        }
    }

    private processNextOperation(): void {
        const operationIndex = this.queue.findIndex(
            op => !op.keys.some(key => this.heldKeys.has(key))
        );

        if (operationIndex === -1) {
            return;
        }

        const operation = this.queue.splice(operationIndex, 1)[0];
        if (operation === undefined) return;

        for (const key of operation.keys) {
            this.heldKeys.add(key);
        }

        operation.execute()
            .then(operation.resolve)
            .catch(operation.reject)
            .finally(() => {
                for (const key of operation.keys) {
                    this.heldKeys.delete(key);
                }
                this.processQueue();
            });
    }

    get activeKeys(): readonly string[] {
        return freeze([...this.heldKeys]);
    }

    get queueLength(): number {
        return this.queue.length;
    }

    getStats(): {
        queuedOperations: number;
        heldKeys: number;
        totalOperations: number;
    } {
        return {
            queuedOperations: this.queue.length,
            heldKeys: this.heldKeys.size,
            totalOperations: this.operationCounter
        };
    }

    clearQueue(): void {
        for (const operation of this.queue) {
            operation.reject(new Error('Queue cleared'));
        }
        this.queue.length = 0;
    }

    hasLock(key: string): boolean {
        return this.heldKeys.has(key);
    }

    waitForLock(key: string, timeoutMs: number = this.defaultTimeoutMs): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const check = () => {
                if (!this.hasLock(key)) {
                    resolve();
                } else if (Date.now() - startTime > timeoutMs) {
                    reject(new Error(`Timeout waiting for lock on key: ${key}`));
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }
}

export { FifoKeyedMutex as KeyedMutex };
