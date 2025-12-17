/// <reference lib="webworker" />

import { expose } from 'comlink';
import { enableMapSet } from 'immer';
import { editHistoryApi } from '@/workers/edit-history/api';
import { initializeDatabase, cleanupDatabase } from '@/workers/edit-history/database';

// Enable immer Map/Set support for immutable collections
enableMapSet();

// Initialize database on worker startup
initializeDatabase().catch((error) => {
    console.error('VC: Failed to initialize database in worker:', error);
});

// Clean up on worker termination
self.addEventListener('unload', () => {
    cleanupDatabase().catch(() => {});
});

// Enhanced error handler for uncaught errors
self.addEventListener('error', (event) => {
    console.error('VC: Uncaught error in worker:', event.error);
    event.preventDefault();
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('VC: Unhandled promise rejection in worker:', event.reason);
    event.preventDefault();
});

// Type exports for main thread
export type { EditHistoryApi } from '@/workers/edit-history/api';
export type {
    StoredEdit,
    StoredManifest,
    StorageType,
    ReconstructionResult,
    PreviousEditContext,
    DatabaseStats,
    IntegrityCheckResult,
    CreateStoredEdit
} from '@/workers/edit-history/types';
export {
    ValidationError,
    SecurityError,
    StateConsistencyError,
    IntegrityError,
    OperationTimeoutError,
    CapacityError,
    ConcurrencyError
} from '@/workers/edit-history/errors';

// Expose the API to the main thread
expose(editHistoryApi);

// Export a health check function for the worker
export const workerHealthCheck = {
    isAlive: () => true,
    getStats: async () => {
        try {
            const db = (await import('@/workers/edit-history/database')).db;
            return {
                databaseOpen: db.isOpen(),
                databaseName: db.name,
                databaseVersion: db.verno
            };
        } catch (error) {
            return {
                databaseOpen: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
};

export type WorkerHealthCheck = typeof workerHealthCheck;
