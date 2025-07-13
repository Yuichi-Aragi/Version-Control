import { injectable } from 'inversify';
import PQueue from 'p-queue';

/**
 * A service that manages and provides access to keyed `p-queue` instances.
 * This ensures that operations on a specific resource (like a file or a note ID)
 * are executed sequentially, preventing race conditions.
 */
@injectable()
export class QueueService {
    private fileQueues = new Map<string, PQueue>();

    /**
     * Retrieves or creates a queue for a specific key.
     * All queues created through this service have a concurrency of 1 to ensure
     * sequential execution of tasks for the same key.
     * @param key A unique key identifying the resource (e.g., a file path or a note ID).
     * @returns A `PQueue` instance for the given key.
     */
    private getQueue(key: string): PQueue {
        if (!this.fileQueues.has(key)) {
            const newQueue = new PQueue({ concurrency: 1 });
            this.fileQueues.set(key, newQueue);
        }
        return this.fileQueues.get(key)!;
    }

    /**
     * Adds a task to the queue for a specific key. The task will be executed
     * after all previously added tasks for the same key have completed.
     * @param key The key identifying the queue.
     * @param task A function that returns a value or a promise to be executed.
     * @returns A promise that resolves with the result of the task.
     */
    public enqueue<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        const queue = this.getQueue(key);

        const promiseReturningTask = (): Promise<T> => {
            try {
                // Wrap the result of the task in Promise.resolve().
                // This handles both cases:
                // 1. If task() returns a value `T`, it becomes `Promise<T>`.
                // 2. If task() returns a `Promise<T>`, it remains `Promise<T>`.
                return Promise.resolve(task());
            } catch (error) {
                // If the task function itself throws a synchronous error,
                // we catch it and return a rejected promise to maintain the promise chain.
                return Promise.reject(error);
            }
        };

        // The TypeScript compiler has difficulty inferring the return type correctly
        // in this specific scenario with nested generics from the p-queue library,
        // sometimes resulting in `Promise<T | void>`.
        // However, our `promiseReturningTask` wrapper guarantees the return type is `Promise<T>`.
        // We use a type assertion to inform the compiler of the correct type, which is safe here.
        return queue.add(promiseReturningTask) as Promise<T>;
    }

    /**
     * Clears the queue for a specific key and stops any pending tasks.
     * This is useful when a resource is deleted and its associated queue is no longer needed.
     * @param key The key of the queue to clear.
     */
    public clear(key: string): void {
        if (this.fileQueues.has(key)) {
            const queue = this.fileQueues.get(key)!;
            queue.clear();
            this.fileQueues.delete(key);
        }
    }

    /**
     * Waits for a specific queue to become idle (empty and no pending tasks).
     * @param key The key of the queue to wait for.
     * @returns A promise that resolves when the queue is idle.
     */
    public async onIdle(key: string): Promise<void> {
        if (this.fileQueues.has(key)) {
            const queue = this.fileQueues.get(key)!;
            await queue.onIdle();
        }
    }
}
