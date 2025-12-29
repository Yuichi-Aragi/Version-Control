import PQueue from 'p-queue';
import { TaskPriority, type TaskOptions } from '@/types';

/**
 * A centralized scheduler for managing concurrent operations across the application.
 * 
 * FEATURES:
 * - Resource-based Locking: Ensures sequential execution for specific resources (e.g., Note IDs).
 * - Priority Scheduling: Critical tasks preempt background tasks.
 * - Deadlock Prevention: Automatically sorts multi-resource locks to prevent circular dependencies.
 * - Scalability: Uses lightweight `p-queue` instances created on demand.
 */

export class QueueService {
    private queues = new Map<string, PQueue>();

    /**
     * Retrieves or creates a priority queue for a specific scope (key).
     * Each queue has a concurrency of 1 to ensure sequential execution within that scope.
     */
    private getQueue(key: string): PQueue {
        if (!this.queues.has(key)) {
            // Concurrency 1 ensures strict sequentiality per resource.
            // PQueue handles the priority ordering internally.
            const newQueue = new PQueue({ concurrency: 1, autoStart: true });
            
            // Cleanup empty queues to prevent memory leaks? 
            // PQueue is lightweight, but we could implement idle cleanup if needed.
            // For now, we keep them to avoid overhead of recreation during bursts.
            this.queues.set(key, newQueue);
        }
        return this.queues.get(key)!;
    }

    /**
     * Schedules a task to run with exclusive access to the specified scope(s).
     * 
     * @param scopes A single key or array of keys representing the resources to lock.
     * @param task The async function to execute.
     * @param options Scheduling options including priority.
     * @returns The result of the task.
     */
    public async add<T>(
        scopes: string | string[], 
        task: () => Promise<T> | T, 
        options: TaskOptions = {}
    ): Promise<T> {
        const priority = options.priority ?? TaskPriority.NORMAL;
        const keys = Array.isArray(scopes) ? scopes : [scopes];
        
        // DEADLOCK PREVENTION:
        // Always acquire locks in deterministic (lexicographical) order.
        // This prevents cycle formation (e.g., A waiting for B while B waits for A).
        keys.sort();

        // Recursive function to acquire locks sequentially
        const executeWithLocks = async (index: number): Promise<T> => {
            if (index >= keys.length) {
                // All locks acquired, execute the actual task
                return await task();
            }

            const currentKey = keys[index]!;
            const queue = this.getQueue(currentKey);

            // Add the next step to the current queue.
            // We use the priority to ensure this task jumps ahead of lower priority tasks
            // waiting for this resource.
            return queue.add(
                () => executeWithLocks(index + 1), 
                { priority }
            ) as Promise<T>;
        };

        return executeWithLocks(0);
    }

    /**
     * Legacy alias for `add` to maintain compatibility during refactoring steps,
     * but enhanced to use priorities.
     * @deprecated Use `add` with explicit priority instead.
     */
    public enqueue<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        return this.add(key, task, { priority: TaskPriority.NORMAL });
    }

    /**
     * Clears the queue for a specific key.
     * WARNING: This aborts pending tasks for this resource. Use with caution.
     */
    public clear(key: string): void {
        if (this.queues.has(key)) {
            const queue = this.queues.get(key)!;
            queue.clear();
            this.queues.delete(key);
        }
    }

    /**
     * Clears all queues.
     * Used during plugin unload.
     */
    public clearAll(): void {
        for (const queue of this.queues.values()) {
            queue.clear();
        }
        this.queues.clear();
    }

    /**
     * Waits for a specific queue to become idle.
     */
    public async onIdle(key: string): Promise<void> {
        if (this.queues.has(key)) {
            const queue = this.queues.get(key)!;
            await queue.onIdle();
        }
    }
}
