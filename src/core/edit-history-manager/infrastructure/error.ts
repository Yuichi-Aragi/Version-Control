import type { OperationMetadata, EditHistoryErrorCode } from '../types';

export class EditHistoryError extends Error {
  readonly timestamp: number;
  readonly operationId?: string;

  constructor(
    message: string,
    readonly code: EditHistoryErrorCode,
    readonly metadata: Partial<OperationMetadata> = {},
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'EditHistoryError';
    this.timestamp = Date.now();
    if (metadata.id !== undefined) {
      this.operationId = metadata.id;
    }
    Object.freeze(this);
  }

  static isRetryable(error: unknown): boolean {
    if (!(error instanceof EditHistoryError)) return false;
    
    switch (error.code) {
      case 'OPERATION_TIMEOUT':
      case 'DISK_WRITE_FAILED':
      case 'DISK_READ_FAILED':
        return true;
      default:
        return false;
    }
  }
}
