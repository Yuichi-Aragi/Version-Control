import { wrap, releaseProxy, type Remote } from 'comlink';
import type { EditWorkerApi } from '@/types';
import { EditHistoryError } from './error';

declare const editHistoryWorkerString: string;

export class WorkerClient {
  private worker: Worker | null = null;
  private workerProxy: Remote<EditWorkerApi> | null = null;
  private workerUrl: string | null = null;
  private isTerminated = false;

  initialize(): void {
    if (this.isTerminated) {
      throw new EditHistoryError('WorkerClient has been terminated', 'INVALID_STATE');
    }
    
    if (this.worker !== null) return;

    try {
      if (typeof editHistoryWorkerString === 'undefined' || editHistoryWorkerString === '') {
        console.error('Version Control: Edit History worker code missing.');
        return;
      }
      
      const blob = new Blob([editHistoryWorkerString], { type: 'application/javascript' });
      this.workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.workerUrl);
      this.workerProxy = wrap<EditWorkerApi>(this.worker);
      
      this.worker.addEventListener('error', (event) => {
        console.error('Version Control: Worker error', event.error);
      });
    } catch (error) {
      console.error('Version Control: Failed to initialize Edit History worker', error);
      throw new EditHistoryError(
        'Worker initialization failed',
        'WORKER_UNAVAILABLE',
        undefined,
        error
      );
    }
  }

  ensureWorker(): Remote<EditWorkerApi> {
    if (this.isTerminated) {
      throw new EditHistoryError('WorkerClient has been terminated', 'WORKER_UNAVAILABLE');
    }
    
    if (this.workerProxy === null) {
      this.initialize();
    }
    
    if (this.workerProxy === null) {
      throw new EditHistoryError('Edit History Worker not available', 'WORKER_UNAVAILABLE');
    }
    
    return this.workerProxy;
  }

  terminate(): void {
    if (this.isTerminated) return;
    
    this.isTerminated = true;

    if (this.workerProxy !== null) {
      try {
        this.workerProxy.clearAll().catch(() => {});
        this.workerProxy[releaseProxy]();
      } catch {
        // Ignore cleanup errors
      }
      this.workerProxy = null;
    }

    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.workerUrl !== null) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }

  isAvailable(): boolean {
    return !this.isTerminated;
  }
}
