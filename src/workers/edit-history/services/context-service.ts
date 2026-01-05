import { freeze } from 'immer';
import { sortBy } from 'es-toolkit';
import { Dexie } from 'dexie';
import { db } from '@/workers/edit-history/database';
import { ReconstructionService } from '@/workers/edit-history/services/reconstruction-service';
import type { PreviousEditContext } from '@/workers/edit-history/types';

export class ContextService {
    // LRU Cache relying on DB validation for freshness.
    private static readonly contextCache = new Map<string, PreviousEditContext>();
    private static readonly MAX_CACHE_SIZE = 50;

    static async getPreviousEditContext(
        noteId: string,
        branchName: string,
        useCache: boolean = true
    ): Promise<PreviousEditContext | null> {
        return db.execute(async () => {
            // 1. Fetch the authoritative head record from the database.
            const latestRecord = await db.edits
                .where('[noteId+branchName+createdAt]')
                .between(
                    [noteId, branchName, Dexie.minKey],
                    [noteId, branchName, Dexie.maxKey]
                )
                .reverse()
                .first();

            const cacheKey = `${noteId}:${branchName}`;

            if (!latestRecord) {
                // The database has no records for this branch.
                this.contextCache.delete(cacheKey);
                return null;
            }

            // 2. Attempt to use cache with strict validation
            if (useCache) {
                const cached = this.contextCache.get(cacheKey);
                
                if (cached) {
                    if (cached.editId === latestRecord.editId && 
                        cached.contentHash === latestRecord.contentHash) {
                        
                        this.contextCache.delete(cacheKey);
                        this.contextCache.set(cacheKey, cached);
                        
                        return cached;
                    } else {
                        this.contextCache.delete(cacheKey);
                    }
                }
            }

            // 3. Cache Miss or Invalid - Perform Full Reconstruction
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

            const context: PreviousEditContext = freeze({
                editId: lastEdit.editId,
                content: result.content,
                contentHash: result.hash,
                baseEditId: baseEditId ?? lastEdit.editId,
                chainLength: lastEdit.chainLength,
                timestamp: lastEdit.createdAt
            });

            // 4. Update Cache
            this.updateCache(cacheKey, context);

            return context;
        }, 'getPreviousEditContext');
    }

    static async getEditChain(
        noteId: string,
        branchName: string,
        targetEditId: string
    ): Promise<string[]> {
        return db.execute(async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([noteId, branchName])
                .toArray();

            const chain: string[] = [];
            let currentId: string | undefined = targetEditId;
            const visited = new Set<string>();

            while (currentId && !visited.has(currentId)) {
                visited.add(currentId);
                chain.unshift(currentId);
                
                const edit = edits.find(e => e.editId === currentId);
                if (!edit) break;
                
                currentId = edit.previousEditId;
            }

            return chain;
        }, 'getEditChain');
    }

    static async validateChainIntegrity(
        noteId: string,
        branchName: string
    ): Promise<boolean> {
        return db.execute(async () => {
            const edits = await db.edits
                .where('[noteId+branchName]')
                .equals([noteId, branchName])
                .toArray();

            const editMap = new Map(edits.map(e => [e.editId, e]));
            const visited = new Set<string>();

            for (const edit of edits) {
                if (edit.storageType === 'diff' && !edit.previousEditId) {
                    return false;
                }

                if (edit.previousEditId && !editMap.has(edit.previousEditId)) {
                    return false;
                }

                let currentId: string | undefined = edit.editId;
                while (currentId && editMap.has(currentId)) {
                    if (visited.has(currentId)) {
                        return false;
                    }
                    visited.add(currentId);
                    currentId = editMap.get(currentId)?.previousEditId;
                }
            }

            return true;
        }, 'validateChainIntegrity');
    }

    static clearCache(noteId?: string, branchName?: string): void {
        if (noteId && branchName) {
            this.contextCache.delete(`${noteId}:${branchName}`);
        } else if (noteId) {
            for (const key of this.contextCache.keys()) {
                if (key.startsWith(`${noteId}:`)) {
                    this.contextCache.delete(key);
                }
            }
        } else {
            this.contextCache.clear();
        }
    }

    private static updateCache(key: string, context: PreviousEditContext): void {
        this.contextCache.delete(key);
        if (this.contextCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.contextCache.keys().next().value;
            if (oldestKey) {
                this.contextCache.delete(oldestKey);
            }
        }
        this.contextCache.set(key, context);
    }
}
