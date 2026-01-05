export enum OperationPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  BACKGROUND = 4
}

export interface OperationMetadata {
  id: string;
  timestamp: number;
  priority: OperationPriority;
  sequence: number;
  [key: string]: unknown;
}

export type EditHistoryErrorCode =
  | 'WORKER_UNAVAILABLE'
  | 'DISK_WRITE_FAILED'
  | 'DISK_READ_FAILED'
  | 'OPERATION_TIMEOUT'
  | 'OPERATION_CANCELLED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'CONCURRENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'CAPACITY_EXCEEDED';

export interface ScheduledWrite {
  readonly noteId: string;
  readonly branchName: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly retryCount: number;
}

export interface EditHistoryStats {
  pendingWrites: number;
  queuedOperations: number;
  activeOperations: number;
}

// Re-export for backward compatibility
export type {
  WorkerClient,
} from './infrastructure/worker-client';

export {
  EditHistoryWorkerError,
  EditWorkerManager,
} from './infrastructure/worker-client';
