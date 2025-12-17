import { transfer } from 'comlink';
import { freeze } from 'immer';
import type { NoteManifest } from '@/types';
import { FifoKeyedMutex } from '@/workers/edit-history/utils';
import { CompressionService } from '@/workers/edit-history/services';
import {
    EditStorageService,
    HistoryManagementService,
    ImportExportService,
    IntegrityService
} from '@/workers/edit-history/services';
import {
    validateNoteId,
    validateOldNoteId,
    validateNewNoteId,
    validateBranchName,
    validateEditId,
    validatePath,
    validateContent,
    validateNoteManifest,
    validateArrayBuffer
} from '@/workers/edit-history/validation';
import type {
    DatabaseStats,
    IntegrityCheckResult
} from '@/workers/edit-history/types';

// ============================================================================
// CONSTANTS
// ============================================================================

const OPERATION_TIMEOUT_MS = 30000;

// ============================================================================
// MUTEX INSTANCE WITH ENHANCED LOCKING
// ============================================================================

const mutex = new FifoKeyedMutex(OPERATION_TIMEOUT_MS);

// ============================================================================
// ATOMIC OPERATION WRAPPER
// ============================================================================

async function withAtomicLock<T>(
    noteId: string,
    operation: () => Promise<T>,
    branchName?: string
): Promise<T> {
    const key = branchName ? `${noteId}:${branchName}` : noteId;
    return mutex.run(key, operation);
}

// ============================================================================
// ENHANCED API IMPLEMENTATION
// ============================================================================

export const editHistoryApi = {
    async saveEdit(
        noteId: unknown,
        branchName: unknown,
        editId: unknown,
        content: unknown,
        manifestUpdate: unknown
    ): Promise<{ size: number; contentHash: string }> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validEditId = validateEditId(editId);
        const validContent = validateContent(content);
        const validManifest = validateNoteManifest(manifestUpdate);

        return withAtomicLock(validNoteId, async () => {
            const contentStr =
                typeof validContent === 'string'
                    ? validContent
                    : CompressionService.textDecoder.decode(validContent);

            let forceSave = false;

            try {
                const existing = await EditStorageService.getEditContent(
                    validNoteId,
                    validBranchName,
                    validEditId
                );

                if (existing !== null) {
                    const existingStr = CompressionService.textDecoder.decode(existing);
                    if (existingStr === contentStr) {
                         // Even if content is identical, we need to return the stats of the existing record
                         // to ensure the caller gets valid data.
                         // EditStorageService.saveEdit handles idempotency checks.
                    }
                }
            } catch (error) {
                // If checking existing content fails (e.g. IntegrityError due to corruption),
                // we should force save to repair the state.
                console.warn(`[EditHistoryApi] Failed to check existing edit ${validEditId}, forcing overwrite.`, error);
                forceSave = true;
            }

            return await EditStorageService.saveEdit(
                validNoteId,
                validBranchName,
                validEditId,
                contentStr,
                validManifest,
                { force: forceSave }
            );
        }, validBranchName);
    },

    async getEditContent(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<ArrayBuffer | null> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validEditId = validateEditId(editId);

        return withAtomicLock(validNoteId, async () => {
            const buffer = await EditStorageService.getEditContent(
                validNoteId,
                validBranchName,
                validEditId
            );
            
            if (buffer === null) return null;
            
            const copy = buffer.slice(0);
            return transfer(copy, [copy]);
        }, validBranchName);
    },

    async getEditManifest(noteId: unknown): Promise<NoteManifest | null> {
        const validNoteId = validateNoteId(noteId);

        return withAtomicLock(validNoteId, async () => {
            const manifest = await HistoryManagementService.getEditManifest(validNoteId);
            return manifest !== null ? freeze(manifest, true) : null;
        });
    },

    async saveEditManifest(noteId: unknown, manifest: unknown): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validManifest = validateNoteManifest(manifest);

        return withAtomicLock(validNoteId, async () => {
            const existing = await HistoryManagementService.getEditManifest(validNoteId);
            if (existing && JSON.stringify(existing) === JSON.stringify(validManifest)) {
                return;
            }

            await HistoryManagementService.saveEditManifest(validNoteId, validManifest);
        });
    },

    async deleteEdit(
        noteId: unknown,
        branchName: unknown,
        editId: unknown
    ): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validEditId = validateEditId(editId);

        return withAtomicLock(validNoteId, async () => {
            const content = await EditStorageService.getEditContent(
                validNoteId,
                validBranchName,
                validEditId
            );

            if (content === null) return;

            await EditStorageService.deleteEdit(validNoteId, validBranchName, validEditId);
        }, validBranchName);
    },

    async deleteNoteHistory(noteId: unknown): Promise<void> {
        const validNoteId = validateNoteId(noteId);

        return withAtomicLock(validNoteId, async () => {
            const manifest = await HistoryManagementService.getEditManifest(validNoteId);
            if (manifest === null) return;

            await HistoryManagementService.deleteNoteHistory(validNoteId);
        });
    },

    async deleteBranch(noteId: unknown, branchName: unknown): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);

        return withAtomicLock(validNoteId, async () => {
            const manifest = await HistoryManagementService.getEditManifest(validNoteId);
            if (manifest === null || !manifest.branches[validBranchName]) return;

            await HistoryManagementService.deleteBranch(validNoteId, validBranchName);
        }, validBranchName);
    },

    async renameEdit(
        noteId: unknown,
        oldEditId: unknown,
        newEditId: unknown
    ): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validOldEditId = validateEditId(oldEditId, 'oldEditId');
        const validNewEditId = validateEditId(newEditId, 'newEditId');

        if (validOldEditId === validNewEditId) return;

        return withAtomicLock(validNoteId, async () => {
            const manifest = await HistoryManagementService.getEditManifest(validNoteId);
            if (manifest === null) return;

            let targetBranch: string | null = null;
            for (const [branchName, branch] of Object.entries(manifest.branches)) {
                if (branch.versions[validOldEditId]) {
                    targetBranch = branchName;
                    break;
                }
            }

            if (!targetBranch) return;

            await EditStorageService.renameEdit(validNoteId, validOldEditId, validNewEditId);
        });
    },

    async renameNote(
        oldNoteId: unknown,
        newNoteId: unknown,
        newPath: unknown
    ): Promise<void> {
        const validOldNoteId = validateOldNoteId(oldNoteId);
        const validNewNoteId = validateNewNoteId(newNoteId);
        const validNewPath = validatePath(newPath, 'newPath');

        if (validOldNoteId === validNewNoteId) return;

        return mutex.runMultiple(
            [validOldNoteId, validNewNoteId],
            async () => {
                const oldManifest = await HistoryManagementService.getEditManifest(validOldNoteId);
                if (oldManifest === null) return;

                await HistoryManagementService.renameNote(
                    validOldNoteId,
                    validNewNoteId,
                    validNewPath
                );
            }
        );
    },

    async updateNotePath(noteId: unknown, newPath: unknown): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validNewPath = validatePath(newPath, 'newPath');

        return withAtomicLock(validNoteId, async () => {
            const manifest = await HistoryManagementService.getEditManifest(validNoteId);
            if (manifest === null || manifest.notePath === validNewPath) return;

            await HistoryManagementService.updateNotePath(validNoteId, validNewPath);
        });
    },

    async getDatabaseStats(): Promise<DatabaseStats> {
        const { editCount, manifestCount } = await HistoryManagementService.getDatabaseCounts();

        return freeze({
            editCount,
            manifestCount,
            activeKeys: mutex.activeKeys,
            queueLength: mutex.queueLength
        }, true);
    },

    async verifyEditIntegrity(
        noteId: unknown,
        branchName: unknown,
        editId: unknown,
        fix: unknown = false
    ): Promise<IntegrityCheckResult> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validEditId = validateEditId(editId);
        const validFix = typeof fix === 'boolean' ? fix : false;

        return withAtomicLock(validNoteId, async () => {
            const result = await IntegrityService.verifyEditIntegrity(
                validNoteId,
                validBranchName,
                validEditId,
                { fix: validFix }
            );
            return freeze(result, true);
        }, validBranchName);
    },

    async verifyBranchIntegrity(
        noteId: unknown,
        branchName: unknown,
        fix: unknown = false
    ): Promise<readonly IntegrityCheckResult[]> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validFix = typeof fix === 'boolean' ? fix : false;

        return withAtomicLock(validNoteId, async () => {
            const results = await IntegrityService.verifyBranchIntegrity(
                validNoteId,
                validBranchName,
                { fix: validFix }
            );
            return freeze(results, true);
        }, validBranchName);
    },

    async exportBranchData(
        noteId: unknown,
        branchName: unknown
    ): Promise<ArrayBuffer> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);

        return withAtomicLock(validNoteId, async () => {
            const buffer = await ImportExportService.exportBranchData(
                validNoteId,
                validBranchName
            );
            
            const copy = buffer.slice(0);
            return transfer(copy, [copy]);
        }, validBranchName);
    },

    async importBranchData(
        noteId: unknown,
        branchName: unknown,
        zipData: unknown
    ): Promise<void> {
        const validNoteId = validateNoteId(noteId);
        const validBranchName = validateBranchName(branchName);
        const validZipData = validateArrayBuffer(zipData, 'zipData');

        return withAtomicLock(validNoteId, async () => {
            await ImportExportService.importBranchData(
                validNoteId,
                validBranchName,
                validZipData
            );
        }, validBranchName);
    },

    async readManifestFromZip(zipData: unknown): Promise<any> {
        const validZipData = validateArrayBuffer(zipData, 'zipData');
        return ImportExportService.readManifestFromZip(validZipData);
    },

    async clearAll(): Promise<void> {
        await mutex.run('*', async () => {
            await HistoryManagementService.clearAll();
        });
    },

    async healthCheck(): Promise<{ healthy: boolean; errors: string[] }> {
        try {
            const stats = await this.getDatabaseStats();
            const errors: string[] = [];

            if (stats.editCount < 0) errors.push('Invalid edit count');
            if (stats.manifestCount < 0) errors.push('Invalid manifest count');

            return {
                healthy: errors.length === 0,
                errors
            };
        } catch (error) {
            return {
                healthy: false,
                errors: [error instanceof Error ? error.message : 'Unknown error']
            };
        }
    }
} as const;

export type EditHistoryApi = typeof editHistoryApi;
