import { injectable, inject } from 'inversify';
import { TYPES } from '../types/inversify.types';
import { TimelineDatabase } from './storage/timeline-database';
import type { DiffManager } from '../services/diff-manager';
import type { VersionManager } from './version-manager';
import type { PluginEvents } from './plugin-events';
import type { TimelineEvent, VersionHistoryEntry, Change } from '../types';
import { orderBy } from 'lodash-es';

@injectable()
export class TimelineManager {
    private processingQueue: Promise<void> = Promise.resolve();

    constructor(
        @inject(TYPES.TimelineDatabase) private db: TimelineDatabase,
        @inject(TYPES.DiffManager) private diffManager: DiffManager,
        @inject(TYPES.VersionManager) private versionManager: VersionManager,
        @inject(TYPES.EventBus) private eventBus: PluginEvents
    ) {}

    public initialize(): void {
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
     * If gaps are found, it triggers diff generation.
     */
    public async getOrGenerateTimeline(noteId: string, branchName: string): Promise<TimelineEvent[]> {
        // Ensure sequential processing to prevent race conditions during rapid updates
        const currentTask = this.processingQueue.then(async () => {
            const history = await this.versionManager.getVersionHistory(noteId);
            // Filter history for the current branch (versionManager.getVersionHistory returns current branch)
            // Sort chronological: Oldest to Newest
            const sortedHistory = orderBy(history, ['timestamp'], ['asc']);
            
            if (sortedHistory.length === 0) return [];

            const existingEvents = await this.db.getTimeline(noteId, branchName);
            const eventsMap = new Map(existingEvents.map(e => [e.toVersionId, e]));
            
            const timeline: TimelineEvent[] = [];
            let previousVersion: VersionHistoryEntry | null = null;

            for (const version of sortedHistory) {
                if (eventsMap.has(version.id)) {
                    const event = eventsMap.get(version.id)!;
                    // Verify linkage integrity. If the 'from' doesn't match our current 'previous',
                    // the chain is broken (e.g. intermediate deletion happened outside logic), regenerate.
                    const expectedFrom = previousVersion ? previousVersion.id : null;
                    
                    if (event.fromVersionId === expectedFrom) {
                        // Backfill metadata if missing (migration logic)
                        if (event.toVersionNumber === undefined) {
                            event.toVersionNumber = version.versionNumber;
                            if (version.name !== undefined) {
                                event.toVersionName = version.name;
                            }
                            if (version.description !== undefined) {
                                event.toVersionDescription = version.description;
                            }
                            await this.db.putEvent(event);
                        }

                        timeline.push(event);
                        previousVersion = version;
                        continue;
                    }
                }

                // Generate missing or invalid event
                const newEvent = await this.generateEvent(noteId, branchName, previousVersion, version);
                await this.db.putEvent(newEvent);
                timeline.push(newEvent);
                
                previousVersion = version;
            }

            // Clean up orphaned events (events in DB that are no longer in history)
            const historyIds = new Set(sortedHistory.map(v => v.id));
            for (const event of existingEvents) {
                if (!historyIds.has(event.toVersionId)) {
                    await this.db.removeEventByVersion(noteId, branchName, event.toVersionId);
                }
            }

            return timeline;
        });

        this.processingQueue = currentTask.then(() => {
            // Chain completes successfully
        }).catch(err => {
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
        let diffChanges: Change[];

        if (fromVersion) {
            const content1 = await this.diffManager.getContent(noteId, fromVersion);
            const content2 = await this.diffManager.getContent(noteId, toVersion);
            diffChanges = await this.diffManager.computeDiff(noteId, fromVersion.id, toVersion.id, content1, content2, 'smart');
        } else {
            // Creation event: Diff against empty string
            const content2 = await this.diffManager.getContent(noteId, toVersion);
            diffChanges = await this.diffManager.computeDiff(noteId, 'creation', toVersion.id, '', content2, 'smart');
        }

        const stats = this.calculateStats(diffChanges);

        const timelineEvent: TimelineEvent = {
            noteId,
            branchName,
            fromVersionId: fromVersion ? fromVersion.id : null,
            toVersionId: toVersion.id,
            timestamp: toVersion.timestamp,
            diffData: diffChanges,
            stats,
            toVersionNumber: toVersion.versionNumber,
        };

        // Only add optional properties if they have values
        if (toVersion.name !== undefined) {
            timelineEvent.toVersionName = toVersion.name;
        }
        if (toVersion.description !== undefined) {
            timelineEvent.toVersionDescription = toVersion.description;
        }

        return timelineEvent;
    }

    private calculateStats(changes: Change[]): { additions: number; deletions: number } {
        let additions = 0;
        let deletions = 0;
        for (const change of changes) {
            if (change.added) additions += change.value.split('\n').length - (change.value.endsWith('\n') ? 1 : 0); // Approx line count
            if (change.removed) deletions += change.value.split('\n').length - (change.value.endsWith('\n') ? 1 : 0);
        }
        // Fallback if split logic is too rough, usually diff returns count property for lines
        additions = 0;
        deletions = 0;
        for (const change of changes) {
            if (change.added && change.count) additions += change.count;
            if (change.removed && change.count) deletions += change.count;
        }
        return { additions, deletions };
    }

    private async handleVersionSaved(_noteId: string): Promise<void> {
        // We don't need to do anything immediately complex. 
        // The next time the timeline is requested, it will auto-heal.
    }

    private async handleVersionDeleted(_noteId: string): Promise<void> {
        // When a version is deleted, the chain breaks.
        // The getOrGenerateTimeline logic handles this automatically by verifying the chain.
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
