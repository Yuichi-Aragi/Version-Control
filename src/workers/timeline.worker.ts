/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import { Dexie, type Table } from 'dexie';
import { diffLines } from 'diff';
import type { TimelineEvent, TimelineStats } from '../types';

/**
 * Dedicated worker for Timeline operations.
 * Handles both the IndexedDB storage (via Dexie) and the compute-heavy
 * diff generation for timeline events.
 * 
 * Implements serialization and ownership transfer for large data payloads
 * to minimize main-thread copying overhead.
 */

class InternalTimelineDB extends Dexie {
    public timeline!: Table<TimelineEvent, number>;

    constructor() {
        super('VersionControlTimelineDB');
        
        // Define schema matching the main thread definition
        this.version(1).stores({
            timeline: '++id, [noteId+branchName], toVersionId, timestamp'
        });

        this.version(2).stores({
            timeline: '++id, [noteId+branchName], [noteId+branchName+toVersionId], toVersionId, timestamp'
        });

        this.version(3).stores({});
    }
}

const db = new InternalTimelineDB();
const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * Serializes data to JSON and transfers the underlying ArrayBuffer.
 * This effectively moves ownership of the result data to the main thread.
 */
function serializeAndTransfer(data: any): ArrayBuffer {
    const json = JSON.stringify(data);
    const uint8Array = encoder.encode(json);
    // Cast to ArrayBuffer to satisfy TypeScript's Transferable requirement
    const buffer = uint8Array.buffer as ArrayBuffer;
    return transfer(buffer, [buffer]);
}

const timelineApi = {
    /**
     * Retrieves the full timeline for a specific note and branch.
     * Returns a transferred ArrayBuffer containing the serialized TimelineEvent[].
     */
    async getTimeline(noteId: string, branchName: string): Promise<ArrayBuffer> {
        const events = await db.timeline
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .sortBy('timestamp');
        
        return serializeAndTransfer(events);
    },

    /**
     * Generates a diff, stores the event, and returns it.
     * Inputs can be transferred ArrayBuffers.
     * Output is a transferred ArrayBuffer containing the serialized TimelineEvent.
     */
    async generateAndStoreEvent(
        noteId: string,
        branchName: string,
        fromVersionId: string | null,
        toVersionId: string,
        toVersionTimestamp: string,
        toVersionNumber: number,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        metadata?: { name?: string; description?: string }
    ): Promise<ArrayBuffer> {
        // 1. Decode content if necessary
        const str1 = typeof content1 === 'string' ? content1 : decoder.decode(content1);
        const str2 = typeof content2 === 'string' ? content2 : decoder.decode(content2);

        // 2. Sanitize
        const clean1 = str1.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const clean2 = str2.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

        // 3. Compute Diff
        const changes = diffLines(clean1, clean2, { ignoreWhitespace: false });

        // 4. Calculate Stats
        let additions = 0;
        let deletions = 0;
        for (const change of changes) {
            if (change.added && change.count) additions += change.count;
            if (change.removed && change.count) deletions += change.count;
        }
        const stats: TimelineStats = { additions, deletions };

        // 5. Construct Event
        const event: TimelineEvent = {
            noteId,
            branchName,
            fromVersionId,
            toVersionId,
            timestamp: toVersionTimestamp,
            diffData: changes,
            stats,
            toVersionNumber,
            toVersionName: metadata?.name,
            toVersionDescription: metadata?.description,
        };

        // 6. Store in DB (Idempotent update)
        await db.transaction('rw', db.timeline, async () => {
            const existing = await db.timeline
                .where({ noteId, branchName, toVersionId })
                .first();
            
            if (existing && existing.id !== undefined) {
                event.id = existing.id;
            }
            await db.timeline.put(event);
        });

        return serializeAndTransfer(event);
    },

    async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        await db.timeline
            .where({ noteId, toVersionId: versionId })
            .modify(event => {
                if (data.name !== undefined) event.toVersionName = data.name;
                if (data.description !== undefined) event.toVersionDescription = data.description;
            });
    },

    async removeEventByVersion(noteId: string, branchName: string, versionId: string): Promise<void> {
        await db.timeline
            .where('[noteId+branchName+toVersionId]')
            .equals([noteId, branchName, versionId])
            .delete();
    },

    async clearTimelineForNote(noteId: string): Promise<void> {
        await db.timeline
            .where('[noteId+branchName]')
            .between([noteId, Dexie.minKey], [noteId, Dexie.maxKey])
            .delete();
    },

    async clearAll(): Promise<void> {
        await db.timeline.clear();
    }
};

expose(timelineApi);
