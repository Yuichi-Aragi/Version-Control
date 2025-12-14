import type { NoteManifest } from '@/types';

export type StorageType = 'full' | 'diff';

export interface StoredEdit {
    id?: number;
    noteId: string;
    branchName: string;
    editId: string;
    content: ArrayBuffer;
    contentHash: string;
    storageType: StorageType;
    baseEditId?: string;
    previousEditId?: string;
    chainLength: number;
    createdAt: number;
    size: number;
    uncompressedSize: number;
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
}

export interface PreviousEditContext {
    readonly editId: string;
    readonly content: string;
    readonly contentHash: string;
    readonly baseEditId: string;
    readonly chainLength: number;
}

export interface DatabaseStats {
    readonly editCount: number;
    readonly manifestCount: number;
    readonly activeKeys: readonly string[];
}

export interface IntegrityCheckResult {
    readonly valid: boolean;
    readonly expectedHash: string;
    readonly actualHash: string;
}
