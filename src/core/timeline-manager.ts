import { injectable, inject } from 'inversify';
import { TYPES } from '../types/inversify.types';
import { TimelineDatabase } from './storage/timeline-database';
import type { DiffManager } from '../services/diff-manager';
import type { VersionManager } from './version-manager';
import type { PluginEvents } from './plugin-events';
import type { TimelineEvent, VersionHistoryEntry } from '../types';
import { orderBy } from 'lodash-es';
import { VersionContentRepository } from './storage/version-content-repository';

@injectable()
export class TimelineManager {
    private processingQueue: Promise<void> = Promise.resolve();

    constructor(
        @inject(TYPES.TimelineDatabase) private db: TimelineDatabase,
        @inject(TYPES.DiffManager) private diffManager: DiffManager,
        @inject(TYPES.VersionManager) private versionManager: VersionManager,
        @inject(TYPES.VersionContentRepo) private contentRepo: VersionContentRepository,
        @inject(TYPES.EventBus) private eventBus: PluginEvents
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
     * Ensures the timeline exists and is up-to-date for the given note and branch.
     * If gaps are found, it fetches content (binary if possible) and offloads diffing to the worker.
     */
    public async getOrGenerateTimeline(noteId: string, branchName: string): Promise<TimelineEvent[]> {
        const currentTask = this.processingQueue.then(async () => {
            const history = await this.versionManager.getVersionHistory(noteId);
            const sortedHistory = orderBy(history, ['timestamp'], ['asc']);
            
            if (sortedHistory.length === 0) return [];

            const existingEvents = await this.db.getTimeline(noteId, branchName);
            const eventsMap = new Map(existingEvents.map(e => [e.toVersionId, e]));
            
            const timeline: TimelineEvent[] = [];
            let previousVersion: VersionHistoryEntry | null = null;

            for (const version of sortedHistory) {
                if (eventsMap.has(version.id)) {
                    const event = eventsMap.get(version.id)!;
                    const expectedFrom = previousVersion ? previousVersion.id : null;
                    
                    if (event.fromVersionId === expectedFrom) {
                        // Backfill metadata if missing
                        if (event.toVersionNumber === undefined) {
                            // This would require an update call, but for now we just push to timeline
                        }
                        timeline.push(event);
                        previousVersion = version;
                        continue;
                    }
                }

                // Generate missing or invalid event
                const newEvent = await this.generateEvent(noteId, branchName, previousVersion, version);
                timeline.push(newEvent);
                
                previousVersion = version;
            }

            // Clean up orphaned events
            const historyIds = new Set(sortedHistory.map(v => v.id));
            for (const event of existingEvents) {
                if (!historyIds.has(event.toVersionId)) {
                    await this.db.removeEventByVersion(noteId, branchName, event.toVersionId);
                }
            }

            return timeline;
        });

        this.processingQueue = currentTask.then(() => {}).catch(err => {
            console.error("VC: Timeline generation error", err);
        });
        return currentTask;
    }

    private async generateEvent(
        noteId: string, 
        branchName: string, 
        fromVersion: VersionHistoryEntry | null, 
        toVersion: VersionHistoryEntry
    ): Promise<TimelineEvent> {
        let content1: string | ArrayBuffer = '';
        let content2: string | ArrayBuffer = '';

        // 1. Fetch Content 1 (From Version)
        if (fromVersion) {
            const buffer1 = await this.contentRepo.readBinary(noteId, fromVersion.id);
            if (buffer1) {
                content1 = buffer1;
            } else {
                // Fallback to string read if binary fails (unlikely) or for consistency
                content1 = await this.diffManager.getContent(noteId, fromVersion);
            }
        } else {
            // Creation event: content1 is empty string
            content1 = '';
        }

        // 2. Fetch Content 2 (To Version)
        // If 'toVersion' is somehow 'current' (not typical for timeline history, but possible in diffs),
        // we must use string. But timeline usually tracks saved history.
        // Assuming toVersion is a history entry here.
        const buffer2 = await this.contentRepo.readBinary(noteId, toVersion.id);
        if (buffer2) {
            content2 = buffer2;
        } else {
            content2 = await this.diffManager.getContent(noteId, toVersion);
        }

        // 3. Delegate to Worker
        return await this.db.generateAndStoreEvent(
            noteId,
            branchName,
            fromVersion ? fromVersion.id : null,
            toVersion.id,
            toVersion.timestamp,
            toVersion.versionNumber,
            content1,
            content2,
            { name: toVersion.name, description: toVersion.description }
        );
    }

    private async handleVersionSaved(_noteId: string): Promise<void> {
        // Timeline auto-heals on next view
    }

    private async handleVersionDeleted(_noteId: string): Promise<void> {
        // Timeline auto-heals on next view
    }

    private async handleHistoryDeleted(noteId: string): Promise<void> {
        this.processingQueue = this.processingQueue.then(async () => {
            await this.db.clearTimelineForNote(noteId);
        }).catch(err => console.error("VC: Failed to clear timeline for deleted history", err));
    }

    private async handleVersionUpdated(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        this.processingQueue = this.processingQueue.then(async () => {
            await this.db.updateEventMetadata(noteId, versionId, data);
        }).catch(err => console.error("VC: Failed to update timeline metadata", err));
    }
}
