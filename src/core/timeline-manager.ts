import { TimelineDatabase } from '@/core';
import type { DiffManager } from '@/services';
import type { VersionManager } from '@/core';
import type { EditHistoryManager } from '@/core';
import type { PluginEvents } from '@/core';
import type { TimelineEvent, VersionHistoryEntry } from '@/types';
import { orderBy } from 'es-toolkit';
import { VersionContentRepository } from '@/core';

export class TimelineManager {
    private processingQueue: Promise<void> = Promise.resolve();

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
     * If gaps are found, it fetches content (binary if possible) and offloads diffing to the worker.
     */
    public async getOrGenerateTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<TimelineEvent[]> {
        const currentTask = this.processingQueue.then(async () => {
            let history: VersionHistoryEntry[] = [];
            
            if (source === 'version') {
                history = await this.versionManager.getVersionHistory(noteId);
            } else {
                history = await this.editHistoryManager.getEditHistory(noteId);
            }

            const sortedHistory = orderBy(history, ['timestamp'], ['asc']);
            
            if (sortedHistory.length === 0) return [];

            const existingEvents = await this.db.getTimeline(noteId, branchName, source);
            const eventsMap = new Map(existingEvents.map(e => [e.toVersionId, e]));
            
            const timeline: TimelineEvent[] = [];
            let previousVersion: VersionHistoryEntry | null = null;

            for (const version of sortedHistory) {
                if (eventsMap.has(version.id)) {
                    const event = eventsMap.get(version.id)!;
                    const expectedFrom = previousVersion ? previousVersion.id : null;
                    
                    if (event.fromVersionId === expectedFrom) {
                        timeline.push(event);
                        previousVersion = version;
                        continue;
                    }
                }

                // Generate missing or invalid event
                const newEvent = await this.generateEvent(noteId, branchName, source, previousVersion, version);
                timeline.push(newEvent);
                
                previousVersion = version;
            }

            // Clean up orphaned events
            const historyIds = new Set(sortedHistory.map(v => v.id));
            for (const event of existingEvents) {
                if (!historyIds.has(event.toVersionId)) {
                    await this.db.removeEventByVersion(noteId, branchName, source, event.toVersionId);
                }
            }

            return timeline;
        });

        this.processingQueue = currentTask.then(() => {}).catch(err => {
            console.error("VC: Timeline generation error", err);
        });
        return currentTask;
    }

    /**
     * Public method to generate a single event for a newly added version without
     * reloading the entire timeline. Useful for instant UI updates.
     */
    public async createEventForNewVersion(
        noteId: string,
        branchName: string,
        source: 'version' | 'edit',
        newVersion: VersionHistoryEntry
    ): Promise<TimelineEvent | null> {
        return this.processingQueue.then(async () => {
            // Find previous version
            let history: VersionHistoryEntry[] = [];
            if (source === 'version') {
                history = await this.versionManager.getVersionHistory(noteId);
            } else {
                history = await this.editHistoryManager.getEditHistory(noteId);
            }
            
            // History is usually sorted desc by version/timestamp.
            // The previous version is the one immediately following the new version in the list.
            const sortedHistory = orderBy(history, ['timestamp'], ['desc']);
            const newIndex = sortedHistory.findIndex(v => v.id === newVersion.id);
            
            if (newIndex === -1) return null; // Should not happen if history is updated
            
            const previousVersion = sortedHistory[newIndex + 1] || null;
            
            return await this.generateEvent(noteId, branchName, source, previousVersion, newVersion);
        });
    }

    private async generateEvent(
        noteId: string, 
        branchName: string, 
        source: 'version' | 'edit',
        fromVersion: VersionHistoryEntry | null, 
        toVersion: VersionHistoryEntry
    ): Promise<TimelineEvent> {
        let content1: string | ArrayBuffer = '';
        let content2: string | ArrayBuffer = '';

        // Helper to fetch content based on source
        const fetchContent = async (version: VersionHistoryEntry): Promise<string | ArrayBuffer> => {
            if (source === 'version') {
                const buffer = await this.contentRepo.readBinary(noteId, version.id);
                if (buffer) return buffer;
                return await this.diffManager.getContent(noteId, version) || '';
            } else {
                const content = await this.editHistoryManager.getEditContent(noteId, version.id);
                return content || '';
            }
        };

        // 1. Fetch Content 1 (From Version)
        if (fromVersion) {
            content1 = await fetchContent(fromVersion);
        } else {
            // Creation event: content1 is empty string
            content1 = '';
        }

        // 2. Fetch Content 2 (To Version)
        content2 = await fetchContent(toVersion);

        // 3. Delegate to Worker
        return await this.db.generateAndStoreEvent(
            noteId,
            branchName,
            source,
            fromVersion ? fromVersion.id : null,
            toVersion.id,
            toVersion.timestamp,
            toVersion.versionNumber,
            content1,
            content2,
            (() => {
                const metadata: { name?: string; description?: string } = {};
                if (toVersion.name) metadata.name = toVersion.name;
                if (toVersion.description) metadata.description = toVersion.description;
                return metadata;
            })()
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
