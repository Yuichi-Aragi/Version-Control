import type { NoteManifest } from '@/types';

export type StorageType = 'full' | 'diff';

export interface StoredEdit {
    readonly id?: number;
    readonly noteId: string;
    readonly branchName: string;
    readonly editId: string;
    readonly content: ArrayBuffer;
    readonly contentHash: string;
    readonly storageType: StorageType;
    readonly baseEditId?: string;
    readonly previousEditId?: string;
    readonly chainLength: number;
    readonly createdAt: number;
    readonly updatedAt?: number;
    readonly size: number;
    readonly uncompressedSize: number;
}

export interface StoredManifest {
    readonly noteId: string;
    readonly manifest: NoteManifest;
    readonly updatedAt: number;
}

export interface ReconstructionResult {
    readonly content: string;
    readonly hash: string;
    readonly verified: boolean;
    readonly chainLength: number;
    readonly reconstructionTime: number;
    readonly repairedFrom?: string;
    readonly note?: string;
}

export interface PreviousEditContext {
    readonly editId: string;
    readonly content: string;
    readonly contentHash: string;
    readonly baseEditId: string;
    readonly chainLength: number;
    readonly timestamp: number;
}

export interface DatabaseStats {
    readonly editCount: number;
    readonly manifestCount: number;
    readonly activeKeys: readonly string[];
    readonly queueLength: number;
}

export interface IntegrityCheckResult {
    readonly valid: boolean;
    readonly expectedHash: string;
    readonly actualHash: string;
    readonly editId?: string;
    readonly noteId?: string;
    readonly branchName?: string;
    readonly verifiedAt: string;
    readonly error?: string;
    readonly wasHealed?: boolean;
}

export type CreateStoredEdit = Omit<StoredEdit, 'id' | 'updatedAt'>;

export interface OperationMetrics {
    readonly operationId: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly duration: number;
    readonly success: boolean;
    readonly error?: string;
}

export interface CompressionStats {
    readonly originalSize: number;
    readonly compressedSize: number;
    readonly ratio: number;
    readonly algorithm: string;
}

export interface BranchStats {
    readonly branchName: string;
    readonly editCount: number;
    readonly totalSize: number;
    readonly avgEditSize: number;
    readonly chainLengths: number[];
    readonly storageTypes: Record<StorageType, number>;
}

export interface HealthReport {
    readonly database: {
        readonly open: boolean;
        readonly size: number;
        readonly objectCount: number;
    };
    readonly worker: {
        readonly alive: boolean;
        readonly memoryUsage?: number;
    };
    readonly errors: {
        readonly recent: string[];
        readonly count: number;
    };
    readonly generatedAt: string;
}

export interface ChainValidationResult {
    readonly valid: boolean;
    readonly chainLength: number;
    readonly hasBase: boolean;
    readonly isComplete: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly diagnostics: Readonly<Record<string, unknown>>;
}
