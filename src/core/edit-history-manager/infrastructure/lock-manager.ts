export class LockManager {
  private readonly noteLocks = new Map<string, Promise<void>>();

  async runSerialized<T>(noteId: string, operation: () => Promise<T>): Promise<T> {
    let release: () => void;
    const lockPromise = new Promise<void>(resolve => { release = resolve; });
    
    // Atomically swap the promise
    const prevPromise = this.noteLocks.get(noteId) || Promise.resolve();
    this.noteLocks.set(noteId, lockPromise);
    
    try {
      await prevPromise;
      return await operation();
    } finally {
      release!();
      // Cleanup if we are the last one
      if (this.noteLocks.get(noteId) === lockPromise) {
        this.noteLocks.delete(noteId);
      }
    }
  }
}
