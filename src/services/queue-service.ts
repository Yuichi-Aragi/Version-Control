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
        return new Promise<T>((resolve, reject) => {
            // We add a task to the queue. We don't use the return value of `add` itself,
            // as we will resolve/reject our own promise from within the task's execution.
            queue.add(async () => {
                try {
                    // Await the original task. This correctly handles both plain values and promises.
                    const result = await task();
                    // If the task succeeds, resolve our outer promise with the result.
                    resolve(result);
                } catch (error) {
                    // If the task throws an error, reject our outer promise.
                    reject(error);
                }
            }).catch(error => {
                // This secondary catch handles errors related to the queue operation itself,
                // such as the queue being cleared before the task can run.
                reject(error);
            });
        });
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
     * Clears all managed queues and stops any pending tasks.
     * This is a critical cleanup step during plugin unload to prevent orphaned operations.
     */
    public clearAll(): void {
        for (const queue of this.fileQueues.values()) {
            queue.clear();
        }
        this.fileQueues.clear();
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
