import { Dexie, type Table } from 'dexie';
import { injectable } from 'inversify';
import type { TimelineEvent } from '../../types';

/**
 * A robust IndexedDB wrapper using Dexie for storing timeline diffs.
 * Handles schema definitions, migrations, and typed access to the timeline data.
 */
@injectable()
export class TimelineDatabase extends Dexie {
    public timeline!: Table<TimelineEvent, number>;

    constructor() {
        super('VersionControlTimelineDB');
        
        // Define schema
        // We index by [noteId+branchName] for fast retrieval of a specific timeline.
        // We also index by timestamp to ensure chronological ordering.
        // We index by toVersionId to quickly find specific events during updates.
        this.version(1).stores({
            timeline: '++id, [noteId+branchName], toVersionId, timestamp'
        });

        // Version 2: Add compound index [noteId+branchName+toVersionId] to optimize putEvent lookups
        // and suppress Dexie warnings regarding compound queries.
        this.version(2).stores({
            timeline: '++id, [noteId+branchName], [noteId+branchName+toVersionId], toVersionId, timestamp'
        });

        // Version 3: No schema changes for indices, but TimelineEvent structure updated to include metadata.
        // Dexie handles new fields automatically.
        this.version(3).stores({});
    }

    /**
     * Retrieves the full timeline for a specific note and branch, ordered by timestamp.
     */
    public async getTimeline(noteId: string, branchName: string): Promise<TimelineEvent[]> {
        return this.timeline
            .where('[noteId+branchName]')
            .equals([noteId, branchName])
            .sortBy('timestamp');
    }

    /**
     * Adds or updates a timeline event.
     * Uses a transaction to ensure integrity if we were to expand this logic.
     */
    public async putEvent(event: TimelineEvent): Promise<void> {
        // Check if an event for this specific transition already exists to avoid duplication/churn
        // primarily keyed by the destination version (toVersionId) within the note/branch context.
        // However, since we use auto-increment ID, we query first.
        
        await this.transaction('rw', this.timeline, async () => {
            // This query utilizes the [noteId+branchName+toVersionId] index defined in version 2
            const existing = await this.timeline
                .where({ noteId: event.noteId, branchName: event.branchName, toVersionId: event.toVersionId })
                .first();
            
            if (existing && existing.id !== undefined) {
                event.id = existing.id;
            }
            
            await this.timeline.put(event);
        });
    }

    /**
     * Updates metadata (name, description) for a specific version event.
     * This updates any event where the 'toVersionId' matches, regardless of branch,
     * though typically version IDs are unique per note.
     */
    public async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        await this.timeline
            .where({ noteId: noteId, toVersionId: versionId })
            .modify(event => {
                if (data.name !== undefined) event.toVersionName = data.name;
                if (data.description !== undefined) event.toVersionDescription = data.description;
            });
    }

    /**
     * Removes an event associated with a specific version in a specific branch.
     * Uses the compound index [noteId+branchName+toVersionId] to avoid Dexie warnings.
     */
    public async removeEventByVersion(noteId: string, branchName: string, versionId: string): Promise<void> {
        await this.timeline
            .where('[noteId+branchName+toVersionId]')
            .equals([noteId, branchName, versionId])
            .delete();
    }

    /**
     * Clears all timeline data for a specific note (e.g., when note history is deleted).
     */
    public async clearTimelineForNote(noteId: string): Promise<void> {
        // Dexie doesn't support deleting by partial compound index directly in all cases efficiently,
        // but iterating and deleting is safe.
        // Alternatively, we can just delete where noteId matches if we indexed it alone, 
        // but our compound index is [noteId+branchName].
        // We can iterate the collection.
        
        await this.timeline
            .where('[noteId+branchName]')
            .between([noteId, Dexie.minKey], [noteId, Dexie.maxKey])
            .delete();
    }

    public async clearAll(): Promise<void> {
        await this.timeline.clear();
    }
}
