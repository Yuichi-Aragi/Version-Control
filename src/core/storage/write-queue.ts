import { injectable } from 'inversify';

/**
 * A generic, keyed queue to serialize asynchronous write operations.
 * This prevents race conditions when multiple operations try to modify the same resource.
 */
@injectable()
export class WriteQueue {
    private queues = new Map<string, Promise<any>>();

    /**
     * Enqueues a task to be executed. Tasks with the same key are executed sequentially.
     * @param key A unique key identifying the resource to be locked (e.g., a file path or ID).
     * @param task A function that returns a promise to be executed.
     * @returns A promise that resolves with the result of the task.
     */
    public enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
        const lastPromise = this.queues.get(key) || Promise.resolve();

        const newPromise = lastPromise.then(task).catch(err => {
            console.error(`VC: Error during queued operation for key "${key}".`, err);
            // Re-throw to ensure the original caller's promise is rejected
            throw err;
        });

        this.queues.set(key, newPromise);
        return newPromise;
    }

    /**
     * Clears the queue for a specific key. This is useful when the resource is deleted.
     * @param key The key of the queue to clear.
     */
    public clear(key: string): void {
        this.queues.delete(key);
    }
}