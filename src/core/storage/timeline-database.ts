import { injectable } from 'inversify';
import { Component } from 'obsidian';
import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import type { TimelineEvent, TimelineWorkerApi } from '../../types';

declare const timelineWorkerString: string;

/**
 * Main thread client for the Timeline Worker.
 * Manages the worker lifecycle and proxies calls to the worker.
 * Handles serialization/deserialization to optimize data transfer.
 */
@injectable()
export class TimelineDatabase extends Component {
    private worker: Worker | null = null;
    private workerProxy: Remote<TimelineWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private isTerminating = false;
    private decoder = new TextDecoder('utf-8');

    constructor() {
        super();
    }

    public initialize(): void {
        this.initializeWorker();
    }

    private initializeWorker(): void {
        if (this.worker || this.isTerminating) return;

        try {
            if (typeof timelineWorkerString === 'undefined' || timelineWorkerString === '') {
                console.error("Version Control: Timeline worker code missing.");
                return;
            }

            const blob = new Blob([timelineWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.workerProxy = wrap<TimelineWorkerApi>(this.worker);
        } catch (error) {
            console.error("Version Control: Failed to initialize timeline worker", error);
        }
    }

    private deserialize<T>(buffer: ArrayBuffer): T {
        const json = this.decoder.decode(buffer);
        return JSON.parse(json);
    }

    public async getTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<TimelineEvent[]> {
        if (!this.workerProxy) await this.initializeWorker();
        if (!this.workerProxy) return [];
        
        try {
            // Worker returns an ArrayBuffer (transferred ownership)
            const buffer = await this.workerProxy.getTimeline(noteId, branchName, source);
            return this.deserialize<TimelineEvent[]>(buffer);
        } catch (error) {
            console.error("VC: Failed to get timeline from worker", error);
            return [];
        }
    }

    /**
     * Delegates event generation and storage to the worker.
     * Supports transferring ownership of ArrayBuffers for both requests (inputs) and results (output).
     */
    public async generateAndStoreEvent(
        noteId: string,
        branchName: string,
        source: 'version' | 'edit',
        fromVersionId: string | null,
        toVersionId: string,
        toVersionTimestamp: string,
        toVersionNumber: number,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        metadata?: { name?: string; description?: string }
    ): Promise<TimelineEvent> {
        if (!this.workerProxy) await this.initializeWorker();
        if (!this.workerProxy) throw new Error("Timeline worker unavailable");

        // Prepare transferables for inputs
        // We must wrap the specific arguments that are transferables using Comlink.transfer()
        const c1 = content1 instanceof ArrayBuffer ? transfer(content1, [content1]) : content1;
        const c2 = content2 instanceof ArrayBuffer ? transfer(content2, [content2]) : content2;

        try {
            // Worker returns an ArrayBuffer (transferred ownership)
            const resultBuffer = await this.workerProxy.generateAndStoreEvent(
                noteId,
                branchName,
                source,
                fromVersionId,
                toVersionId,
                toVersionTimestamp,
                toVersionNumber,
                c1,
                c2,
                metadata
            );
            
            return this.deserialize<TimelineEvent>(resultBuffer);
        } catch (error) {
            console.error("VC: Failed to generate event in worker", error);
            throw error;
        }
    }

    public async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        if (!this.workerProxy) return;
        await this.workerProxy.updateEventMetadata(noteId, versionId, data);
    }

    public async removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void> {
        if (!this.workerProxy) return;
        await this.workerProxy.removeEventByVersion(noteId, branchName, source, versionId);
    }

    public async clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void> {
        if (!this.workerProxy) return;
        await this.workerProxy.clearTimelineForNote(noteId, source);
    }

    public async clearAll(): Promise<void> {
        if (!this.workerProxy) return;
        await this.workerProxy.clearAll();
    }

    public terminate(): void {
        this.isTerminating = true;
        if (this.workerProxy) {
            this.workerProxy[releaseProxy]();
            this.workerProxy = null;
        }
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.workerUrl) {
            URL.revokeObjectURL(this.workerUrl);
            this.workerUrl = null;
        }
        this.isTerminating = false;
    }

    override onunload(): void {
        this.terminate();
    }
}
