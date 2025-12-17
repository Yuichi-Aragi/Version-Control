import { produce, freeze } from 'immer';
import { db } from '@/workers/edit-history/database';
import { ManifestService } from '@/workers/edit-history/services/manifest-service';
import { ContextService } from '@/workers/edit-history/services/context-service';
import { ReconstructionService } from '@/workers/edit-history/services/reconstruction-service';
import { StateConsistencyError } from '@/workers/edit-history/errors';
import type { NoteManifest } from '@/types';

export class HistoryManagementService {
    private static readonly MAX_TRANSACTION_ATTEMPTS = 3;

    static async getEditManifest(noteId: string): Promise<NoteManifest | null> {
        const record = await db.manifests.get(noteId);
        return record ? freeze(record.manifest) : null;
    }

    static async saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void> {
        for (let attempt = 0; attempt < this.MAX_TRANSACTION_ATTEMPTS; attempt++) {
            try {
                await db.transaction('rw', db.manifests, async () => {
                    await db.manifests.put({
                        noteId,
                        manifest,
                        updatedAt: Date.now()
                    });
                });
                return;
            } catch (error) {
                if (attempt === this.MAX_TRANSACTION_ATTEMPTS - 1) {
                    throw new StateConsistencyError(
                        'Failed to save manifest after multiple attempts',
                        { noteId }
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
            }
        }
    }

    static async deleteNoteHistory(noteId: string): Promise<void> {
        await db.transaction('rw', db.edits, db.manifests, async () => {
            await db.edits.where('noteId').equals(noteId).delete();
            await db.manifests.delete(noteId);
        });
        ContextService.clearCache(noteId);
        // Note: ReconstructionService cache is global by editId, so we don't clear specific note entries
        // as iterating the cache to find them might be inefficient and they will naturally expire.
    }

    static async deleteBranch(noteId: string, branchName: string): Promise<void> {
        await db.transaction('rw', db.edits, db.manifests, async () => {
            await db.edits
                .where('[noteId+branchName]')
                .equals([noteId, branchName])
                .delete();

            const record = await db.manifests.get(noteId);
            if (record) {
                const updatedManifest = produce(record.manifest, (draft) => {
                    delete draft.branches[branchName];
                    
                    if (draft.currentBranch === branchName) {
                        const remainingBranches = Object.keys(draft.branches);
                        if (remainingBranches.length > 0) {
                            draft.currentBranch = remainingBranches[0]!;
                        } else {
                            draft.currentBranch = 'main';
                        }
                    }
                    
                    draft.lastModified = new Date().toISOString();
                });

                await db.manifests.put({
                    noteId,
                    manifest: updatedManifest,
                    updatedAt: Date.now()
                });
            }
        });
        ContextService.clearCache(noteId, branchName);
    }

    static async renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void> {
        if (oldNoteId === newNoteId) return;

        await db.transaction('rw', db.edits, db.manifests, async () => {
            const editsCount = await db.edits.where('noteId').equals(oldNoteId).count();
            
            if (editsCount > 0) {
                await db.edits.where('noteId').equals(oldNoteId).modify({ noteId: newNoteId });
            }

            const oldManifestRecord = await db.manifests.get(oldNoteId);
            if (oldManifestRecord) {
                const updatedManifest = ManifestService.updateManifestNoteId(
                    oldManifestRecord.manifest,
                    newNoteId,
                    newPath
                );

                await db.manifests.put({
                    noteId: newNoteId,
                    manifest: updatedManifest,
                    updatedAt: Date.now()
                });

                await db.manifests.delete(oldNoteId);
            }
        });
        ContextService.clearCache(oldNoteId);
    }

    static async updateNotePath(noteId: string, newPath: string): Promise<void> {
        await db.transaction('rw', db.manifests, async () => {
            const record = await db.manifests.get(noteId);
            if (record) {
                const updatedManifest = ManifestService.updateManifestPath(record.manifest, newPath);

                await db.manifests.put({
                    noteId,
                    manifest: updatedManifest,
                    updatedAt: Date.now()
                });
            }
        });
    }

    static async clearAll(): Promise<void> {
        await db.transaction('rw', db.edits, db.manifests, async () => {
            await db.edits.clear();
            await db.manifests.clear();
        });
        ContextService.clearCache();
        ReconstructionService.clearCache();
    }

    static async getDatabaseCounts(): Promise<{ editCount: number; manifestCount: number }> {
        const [editCount, manifestCount] = await Promise.all([
            db.edits.count(),
            db.manifests.count()
        ]);
        
        return { editCount, manifestCount };
    }

    static async getBranchCounts(noteId: string): Promise<Record<string, number>> {
        const edits = await db.edits.where('noteId').equals(noteId).toArray();
        const counts: Record<string, number> = {};

        for (const edit of edits) {
            counts[edit.branchName] = (counts[edit.branchName] || 0) + 1;
        }

        return counts;
    }

    static async validateDatabaseIntegrity(): Promise<boolean> {
        try {
            await db.transaction('r', db.edits, db.manifests, async () => {
                const manifests = await db.manifests.toArray();
                for (const manifest of manifests) {
                    const editCount = await db.edits.where('noteId').equals(manifest.noteId).count();
                    if (editCount === 0 && Object.keys(manifest.manifest.branches).length > 0) {
                        throw new StateConsistencyError(
                            'Orphaned manifest found',
                            { noteId: manifest.noteId }
                        );
                    }
                }
            });
            return true;
        } catch {
            return false;
        }
    }
}
