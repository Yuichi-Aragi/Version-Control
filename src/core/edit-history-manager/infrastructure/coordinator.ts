const OPERATION_TIMEOUT_MS = 30000;

export class AtomicOperationCoordinator {
  private readonly operations = new Map<string, {
    sequence: number;
    lastTimestamp: number;
    pending: Set<string>;
    completed: Set<string>;
  }>();
  
  private readonly operationQueue = new Map<string, {
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }>();

  async beginAtomicOperation(
    key: string,
    operationId: string,
    timeoutMs: number = OPERATION_TIMEOUT_MS
  ): Promise<boolean> {
    const state = this.operations.get(key) ?? {
      sequence: 0,
      lastTimestamp: Date.now(),
      pending: new Set<string>(),
      completed: new Set<string>()
    };

    if (state.pending.has(operationId) || state.completed.has(operationId)) {
      return true;
    }

    // Register operation immediately
    state.pending.add(operationId);
    this.operations.set(key, state);

    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Cleanup on timeout
        const queued = this.operationQueue.get(operationId);
        if (queued) {
            this.operationQueue.delete(operationId);
            
            // Also cleanup state to prevent leaks
            const currentState = this.operations.get(key);
            if (currentState) {
                currentState.pending.delete(operationId);
            }
            
            console.warn(`[EditHistoryManager] Operation ${operationId} timed out (cleanup)`);
        }
      }, timeoutMs);

      this.operationQueue.set(operationId, { resolve, reject, timeoutId });
      
      // Resolve immediately to allow execution to proceed.
      // The coordinator acts as a tracker/observer rather than a blocking mutex here.
      resolve(true);
    });
  }

  completeAtomicOperation(key: string, operationId: string): void {
    const state = this.operations.get(key);
    if (!state) return;

    state.pending.delete(operationId);
    state.completed.add(operationId);
    state.sequence++;
    state.lastTimestamp = Date.now();

    const queued = this.operationQueue.get(operationId);
    if (queued) {
      clearTimeout(queued.timeoutId);
      queued.resolve(true);
      this.operationQueue.delete(operationId);
    }

    if (state.pending.size === 0) {
      state.completed.clear();
    }
  }

  abortAtomicOperation(key: string, operationId: string): void {
    const state = this.operations.get(key);
    if (state) {
      state.pending.delete(operationId);
    }

    const queued = this.operationQueue.get(operationId);
    if (queued) {
      clearTimeout(queued.timeoutId);
      this.operationQueue.delete(operationId);
    }
  }

  isOperationPending(key: string, operationId: string): boolean {
    const state = this.operations.get(key);
    return !!state?.pending.has(operationId);
  }

  getCurrentSequence(key: string): number {
    return this.operations.get(key)?.sequence ?? 0;
  }
}
