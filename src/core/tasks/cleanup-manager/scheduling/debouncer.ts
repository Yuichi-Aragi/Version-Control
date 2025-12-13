import { debounce, type Debouncer } from 'obsidian';
import { CLEANUP_DEBOUNCE_INTERVAL_MS } from '@/core/tasks/cleanup-manager/config';

export class DebouncerManager {
  private readonly debouncedCleanups = new Map<string, Debouncer<[], void>>();
  private isDestroyed = false;

  public createDebouncer(noteId: string, callback: () => void): Debouncer<[], void> {
    let debouncer = this.debouncedCleanups.get(noteId);
    if (!debouncer) {
      debouncer = debounce(() => {
        if (!this.isDestroyed) {
          callback();
        }
      }, CLEANUP_DEBOUNCE_INTERVAL_MS, false);
      this.debouncedCleanups.set(noteId, debouncer);
    }
    return debouncer;
  }

  public getDebouncer(noteId: string): Debouncer<[], void> | undefined {
    return this.debouncedCleanups.get(noteId);
  }

  public removeDebouncer(noteId: string): void {
    const debouncer = this.debouncedCleanups.get(noteId);
    if (debouncer) {
      debouncer.cancel();
      this.debouncedCleanups.delete(noteId);
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.debouncedCleanups.forEach(d => d.cancel());
    this.debouncedCleanups.clear();
  }

  public get destroyed(): boolean {
    return this.isDestroyed;
  }
}
