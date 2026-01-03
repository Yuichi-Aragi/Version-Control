import PQueue from 'p-queue';
import { EditHistoryError } from './error';
import { withRetry } from './retry';
import type { ScheduledWrite } from '../types';

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

export class DebouncedDiskWriter {
  private readonly scheduled = new Map<string, ScheduledWrite>();
  private readonly inProgress = new Set<string>();
  private readonly operationQueue = new PQueue({
    concurrency: 2
  });

  constructor(
    private readonly persistFn: (write: ScheduledWrite) => Promise<void>,
    private readonly debounceMs: number
  ) {}

  schedule(noteId: string, branchName: string): void {
    const key = this.makeKey(noteId, branchName);
    const existing = this.scheduled.get(key);

    if (existing) {
      const updated: ScheduledWrite = {
        ...existing,
        sequence: existing.sequence + 1,
        timestamp: Date.now()
      };
      this.scheduled.set(key, updated);
    } else {
      this.scheduled.set(key, {
        noteId,
        branchName,
        sequence: 1,
        timestamp: Date.now(),
        retryCount: 0
      });
    }

    this.debounceFlush(key);
  }

  async flushAll(): Promise<void> {
    const writes = Array.from(this.scheduled.values());
    this.scheduled.clear();

    await Promise.allSettled(
      writes.map(write => this.executeWrite(write))
    );
  }

  async flush(noteId: string, branchName: string): Promise<void> {
    const key = this.makeKey(noteId, branchName);
    const write = this.scheduled.get(key);
    
    if (write) {
      this.scheduled.delete(key);
      await this.executeWrite(write);
    }
  }

  cancel(noteId: string, branchName: string): void {
    const key = this.makeKey(noteId, branchName);
    this.scheduled.delete(key);
  }

  /**
   * Cancels all pending writes for a specific note ID across all branches.
   * Crucial for preventing race conditions during note deletion.
   */
  cancelNote(noteId: string): void {
    const prefix = `${noteId}:`;
    for (const key of this.scheduled.keys()) {
      if (key.startsWith(prefix)) {
        this.scheduled.delete(key);
      }
    }
  }

  cancelAll(): void {
    this.scheduled.clear();
    this.operationQueue.clear();
  }

  hasPendingWrites(noteId: string, branchName: string): boolean {
    return this.scheduled.has(this.makeKey(noteId, branchName));
  }

  getPendingCount(): number {
    return this.scheduled.size + this.inProgress.size;
  }

  private debounceFlush(key: string): void {
    setTimeout(async () => {
      const write = this.scheduled.get(key);
      if (!write) return;

      const age = Date.now() - write.timestamp;
      if (age >= this.debounceMs) {
        this.scheduled.delete(key);
        await this.executeWrite(write);
      }
    }, this.debounceMs);
  }

  private async executeWrite(write: ScheduledWrite): Promise<void> {
    const key = this.makeKey(write.noteId, write.branchName);
    
    if (this.inProgress.has(key)) {
      this.schedule(write.noteId, write.branchName);
      return;
    }

    this.inProgress.add(key);
    
    try {
      await this.operationQueue.add(
        () => withRetry(
          () => this.persistFn(write),
          MAX_RETRY_ATTEMPTS,
          RETRY_BASE_DELAY_MS,
          EditHistoryError.isRetryable
        ),
        { priority: write.retryCount > 0 ? 0 : 1 }
      );
    } finally {
      this.inProgress.delete(key);
    }
  }

  private makeKey(noteId: string, branchName: string): string {
    return `${noteId}:${branchName}`;
  }
}
