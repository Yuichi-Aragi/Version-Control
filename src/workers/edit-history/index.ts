/// <reference lib="webworker" />

import { expose } from 'comlink';
import { enableMapSet } from 'immer';
import { editHistoryApi } from '@/workers/edit-history/api';

export type { EditHistoryApi } from '@/workers/edit-history/api';
export type {
    StoredEdit,
    StoredManifest,
    StorageType,
    ReconstructionResult,
    PreviousEditContext,
    DatabaseStats,
    IntegrityCheckResult
} from '@/workers/edit-history/types';
export {
    ValidationError,
    SecurityError,
    StateConsistencyError,
    IntegrityError
} from '@/workers/edit-history/errors';

// Enable immer Map/Set support for immutable collections
enableMapSet();

expose(editHistoryApi);
