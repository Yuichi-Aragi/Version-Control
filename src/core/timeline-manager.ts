import { TimelineDatabase } from '@/core';
import type { DiffManager } from '@/services';
import type { VersionManager } from '@/core';
import type { EditHistoryManager } from '@/core';
import type { PluginEvents } from '@/core';
import type { TimelineEvent, VersionHistoryEntry } from '@/types';
import { orderBy } from 'es-toolkit';
import { VersionContentRepository } from '@/core';
import PQueue from 'p-queue';

/**
 * Manages the generation and retrieval of timeline events.
 * 
 * ARCHITECTURE NOTE:
 * This manager implements a high-concurrency pipeline for timeline generation.
 * 
 * 1. Request Deduplication: In-flight requests for the same note/branch are coalesced.
 * 2. Concurrency Control: Uses PQueue to limit concurrent heavy operations (I/O + Worker).
 * 3. Pipelining: Sends multiple requests to the worker simultaneously. The worker is designed
 *    to pipeline CPU-bound diffing with I/O-bound DB writes, maximizing throughput.
 * 4. No Caching: Content is loaded fresh for every event generation to prevent ArrayBuffer
 *    detachment issues during worker transfer.
 * 5. Deterministic Ordering: History is strictly sorted by timestamp and version number
 *    to ensure the timeline chain (v0 -> v1 -> v2) is perfectly linear.
 */
export class TimelineManager {
    /**
     * Queue for managing concurrent timeline generation tasks.
     * Concurrency of 4 offers a good balance between throughput and memory pressure.
     * This allows the main thread to fetch content for the next batch while the 
     * worker is processing the current batch.
     */
    private queue = new PQueue({ concurrency: 4 });

    /**
     * Map to track active timeline generation requests for deduplication.
     * Key: `${noteId}:${branchName}:${source}`
     */
    private activeRequests = new Map<string, Promise<TimelineEvent[]>>();

    constructor(
        private db: TimelineDatabase,
        private diffManager: DiffManager,
        private versionManager: VersionManager,
        private editHistoryManager: EditHistoryManager,
        private contentRepo: VersionContentRepository,
        private eventBus: PluginEvents
    ) {}

    public initialize(): void {
        this.db.initialize();
        this.registerEventListeners();
    }

    private registerEventListeners(): void {
        this.eventBus.on('version-saved', this.handleVersionSaved.bind(this));
        this.eventBus.on('version-deleted', this.handleVersionDeleted.bind(this));
        this.eventBus.on('history-deleted', this.handleHistoryDeleted.bind(this));
        this.eventBus.on('version-updated', this.handleVersionUpdated.bind(this));
    }

    /**
     * Ensures the timeline exists and is up-to-date for the given note, branch, and source.
     * Uses request deduplication to prevent redundant processing.
     */
    public async getOrGenerateTimeline(
        noteId: string, 
        branchName: string, 
        source: 'version' | 'edit'
    ): Promise<TimelineEvent[]> {
        const requestKey = `${noteId}:${branchName}:${source}`;

        // Return existing in-flight request if available
        if (this.activeRequests.has(requestKey)) {
            return this.activeRequests.get(requestKey)!;
        }

        // Create new request
        const promise = this.generateTimelineInternal(noteId, branchName, source)
            .finally(() => {
                this.activeRequests.delete(requestKey);
            });

        this.activeRequests.set(requestKey, promise);
        return promise;
    }

    /**
     * Internal implementation of timeline generation.
     */
    private async generateTimelineInternal(
        noteId: string, 
        branchName: string, 
        source: 'version' | 'edit'
    ): Promise<TimelineEvent[]> {
        // 1. Fetch History & Existing Events in Parallel
        const [history, existingEvents] = await Promise.all([
            source === 'version' 
                ? this.versionManager.getVersionHistory(noteId) 
                : this.editHistoryManager.getEditHistory(noteId),
            this.db.getTimeline(noteId, branchName, source)
        ]);

        // Sort history ascending (oldest to newest) to build linear chain
        // Uses versionNumber as secondary sort key to ensure deterministic order when timestamps match
        const sortedHistory = orderBy(history, ['timestamp', 'versionNumber'], ['asc', 'asc']);
        
        if (sortedHistory.length === 0) return [];

        // Map existing events for quick lookup
        // Key is toVersionId because an event represents the state transition TO that version
        const eventsMap = new Map(existingEvents.map(e => [e.toVersionId, e]));
        
        const missingPairs: Array<{ from: VersionHistoryEntry | null, to: VersionHistoryEntry }> = [];
        let previousVersion: VersionHistoryEntry | null = null;

        // 2. Identify Gaps
        // This loop strictly follows the sorted history order (v0 -> v1 -> v2)
        // ensuring the chain integrity is maintained.
        for (const version of sortedHistory) {
            const existing = eventsMap.get(version.id);
            const expectedFrom = previousVersion ? previousVersion.id : null;

            // Check if event exists and maintains chain integrity (from -> to matches)
            if (existing && existing.fromVersionId === expectedFrom) {
                // Valid event exists
            } else {
                // Missing or invalid chain - needs generation
                missingPairs.push({ from: previousVersion, to: version });
            }
            previousVersion = version;
        }

        // 3. Process Gaps (if any)
        if (missingPairs.length > 0) {
            // Create tasks for queue
            const tasks = missingPairs.map(pair => async () => {
                try {
                    // Fetch content in parallel (I/O bound)
                    // NO CACHING: Load fresh content every time to ensure unique ArrayBuffer instances
                    // and prevent "detached buffer" errors during worker transfer.
                    const [content1, content2] = await Promise.all([
                        pair.from ? this.loadContent(noteId, source, pair.from) : Promise.resolve(''),
                        this.loadContent(noteId, source, pair.to)
                    ]);

                    // Generate event (Worker CPU + DB I/O)
                    return await this.generateEvent(
                        noteId, 
                        branchName, 
                        source, 
                        pair.from, 
                        pair.to, 
                        content1, 
                        content2
                    );
                } catch (error) {
                    console.error(`VC: Failed to generate event for ${pair.to.id}`, error);
                    return null;
                }
            });

            // Execute tasks with concurrency limit
            // Priority 0 (Normal)
            const newEvents = await this.queue.addAll(tasks, { priority: 0 });
            
            // Add new events to map (filtering out failures)
            for (const event of newEvents) {
                if (event) eventsMap.set(event.toVersionId, event);
            }
        }

        // 4. Cleanup Orphans (Events that no longer exist in history)
        const historyIds = new Set(sortedHistory.map(v => v.id));
        const cleanupPromises: Promise<void>[] = [];
        
        for (const event of existingEvents) {
            if (!historyIds.has(event.toVersionId)) {
                cleanupPromises.push(
                    this.db.removeEventByVersion(noteId, branchName, source, event.toVersionId)
                        .catch(err => console.warn("VC: Failed to cleanup orphan event", err))
                );
                eventsMap.delete(event.toVersionId);
            }
        }
        
        if (cleanupPromises.length > 0) {
            await Promise.all(cleanupPromises);
        }

        // 5. Return sorted timeline
        // Re-sort the final collection to guarantee UI receives correct order
        return orderBy(Array.from(eventsMap.values()), ['timestamp', 'toVersionNumber'], ['asc', 'asc']);
    }

    /**
     * Helper to load content based on source type.
     * Prefers binary (ArrayBuffer) to enable zero-copy transfer to worker.
     */
    private async loadContent(
        noteId: string, 
        source: 'version' | 'edit', 
        version: VersionHistoryEntry
    ): Promise<string | ArrayBuffer> {
        if (source === 'version') {
            const buffer = await this.contentRepo.readBinary(noteId, version.id);
            if (buffer) return buffer;
            return await this.diffManager.getContent(noteId, version) || '';
        } else {
            return await this.editHistoryManager.getEditContent(noteId, version.id) || '';
        }
    }

    /**
     * Helper to call the worker.
     */
    private async generateEvent(
        noteId: string, 
        branchName: string, 
        source: 'version' | 'edit',
        fromVersion: VersionHistoryEntry | null, 
        toVersion: VersionHistoryEntry,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer
    ): Promise<TimelineEvent> {
        // CRITICAL: We clone ArrayBuffers before passing to the worker.
        // Even with fresh loading, if content1 and content2 happen to be the same reference
        // (unlikely but possible), passing both to transfer() throws "Duplicate ArrayBuffer".
        // Also protects against any upstream reuse.
        const c1 = content1 instanceof ArrayBuffer ? content1.slice(0) : content1;
        const c2 = content2 instanceof ArrayBuffer ? content2.slice(0) : content2;

        return await this.db.generateAndStoreEvent(
            noteId,
            branchName,
            source,
            fromVersion ? fromVersion.id : null,
            toVersion.id,
            toVersion.timestamp,
            toVersion.versionNumber,
            c1,
            c2,
            (() => {
                const metadata: { name?: string; description?: string } = {};
                if (toVersion.name) metadata.name = toVersion.name;
                if (toVersion.description) metadata.description = toVersion.description;
                return metadata;
            })()
        );
    }

    /**
     * Public method to generate a single event for a newly added version.
     * Uses High Priority (10) to ensure immediate UI feedback.
     */
    public async createEventForNewVersion(
        noteId: string,
        branchName: string,
        source: 'version' | 'edit',
        newVersion: VersionHistoryEntry
    ): Promise<TimelineEvent | null> {
        // Enqueue as high priority task
        return this.queue.add(async () => {
            // Find previous version
            let history: VersionHistoryEntry[] = [];
            if (source === 'version') {
                history = await this.versionManager.getVersionHistory(noteId);
            } else {
                history = await this.editHistoryManager.getEditHistory(noteId);
            }
            
            // Sort strictly to find the correct predecessor
            const sortedHistory = orderBy(history, ['timestamp', 'versionNumber'], ['desc', 'desc']);
            const newIndex = sortedHistory.findIndex(v => v.id === newVersion.id);
            
            if (newIndex === -1) return null;
            
            const previousVersion = sortedHistory[newIndex + 1] || null;
            
            // Load content
            const [content1, content2] = await Promise.all([
                previousVersion ? this.loadContent(noteId, source, previousVersion) : Promise.resolve(''),
                this.loadContent(noteId, source, newVersion)
            ]);

            return await this.generateEvent(
                noteId, 
                branchName, 
                source, 
                previousVersion, 
                newVersion, 
                content1, 
                content2
            );
        }, { priority: 10 });
    }

    private async handleVersionSaved(_noteId: string): Promise<void> {
        // Timeline auto-heals on next view via getOrGenerateTimeline
    }

    private async handleVersionDeleted(_noteId: string): Promise<void> {
        // Timeline auto-heals on next view via getOrGenerateTimeline
    }

    private async handleHistoryDeleted(noteId: string): Promise<void> {
        // High priority cleanup
        this.queue.add(async () => {
            await this.db.clearTimelineForNote(noteId);
        }, { priority: 5 });
    }

    private async handleVersionUpdated(
        noteId: string, 
        versionId: string, 
        data: { name?: string; description?: string }
    ): Promise<void> {
        // High priority metadata update
        this.queue.add(async () => {
            await this.db.updateEventMetadata(noteId, versionId, data);
        }, { priority: 5 });
    }
}
