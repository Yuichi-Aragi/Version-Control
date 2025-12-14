/**
 * Worker health monitoring
 */

import type { WorkerHealthStats } from '@/services/diff-manager/types';

export class WorkerHealthMonitor {
    private consecutiveErrors = 0;
    private lastErrorTime = 0;
    private operationCount = 0;
    private totalOperationTime = 0;
    private readonly maxConsecutiveErrors = 3;
    private readonly errorResetTime = 60000; // 1 minute

    recordOperation(duration: number): void {
        this.operationCount++;
        this.totalOperationTime += duration;

        if (Date.now() - this.lastErrorTime > this.errorResetTime) {
            this.consecutiveErrors = 0;
        }
    }

    recordError(): void {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();
    }

    getAverageOperationTime(): number {
        return this.operationCount > 0 ? this.totalOperationTime / this.operationCount : 0;
    }

    isHealthy(): boolean {
        return this.consecutiveErrors < this.maxConsecutiveErrors;
    }

    getStats(): WorkerHealthStats {
        return {
            consecutiveErrors: this.consecutiveErrors,
            operationCount: this.operationCount,
            averageOperationTime: this.getAverageOperationTime(),
            isHealthy: this.isHealthy()
        };
    }
}
