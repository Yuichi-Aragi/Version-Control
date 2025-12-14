import { freeze } from 'immer';
import { sortBy } from 'es-toolkit';
import { db } from '@/workers/edit-history/database';
import { ReconstructionService } from '@/workers/edit-history/services/reconstruction-service';
import type { PreviousEditContext } from '@/workers/edit-history/types';

export class ContextService {
    static async getPreviousEditContext(
        noteId: string,
        branchName: string
    ): Promise<PreviousEditContext | null> {
        const edits = await db.edits
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .toArray();

        if (edits.length === 0) {
            return null;
        }

        const sortedEdits = sortBy(edits, [(e) => e.createdAt]);
        const lastEdit = sortedEdits[sortedEdits.length - 1];
        if (!lastEdit) {
            return null;
        }

        const editMap = new Map(sortedEdits.map((e) => [e.editId, e]));

        const result = await ReconstructionService.reconstructFromMap(lastEdit.editId, editMap, false);

        let baseEditId = lastEdit.baseEditId;
        if (lastEdit.storageType === 'full') {
            baseEditId = lastEdit.editId;
        } else if (!baseEditId) {
            for (let i = sortedEdits.length - 1; i >= 0; i--) {
                const edit = sortedEdits[i];
                if (edit && edit.storageType === 'full') {
                    baseEditId = edit.editId;
                    break;
                }
            }
        }

        return freeze({
            editId: lastEdit.editId,
            content: result.content,
            contentHash: result.hash,
            baseEditId: baseEditId ?? lastEdit.editId,
            chainLength: lastEdit.chainLength
        });
    }
}
