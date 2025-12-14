import { injectable } from 'inversify';
import { Component } from 'obsidian';
import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import * as v from 'valibot';
import type { TimelineEvent, TimelineWorkerApi } from '@/types';

declare const timelineWorkerString: string;

/**
 * Valibot schemas for input validation.
 */
const NoteIdSchema = v.pipe(
    v.string('noteId must be a string'),
    v.nonEmpty('noteId cannot be empty'),
    v.maxLength(500, 'noteId cannot exceed 500 characters')
);

const BranchNameSchema = v.pipe(
    v.string('branchName must be a string'),
    v.nonEmpty('branchName cannot be empty'),
    v.maxLength(255, 'branchName cannot exceed 255 characters')
);

const VersionIdSchema = v.pipe(
    v.string('versionId must be a string'),
    v.nonEmpty('versionId cannot be empty'),
    v.maxLength(500, 'versionId cannot exceed 500 characters')
);

const SourceSchema = v.picklist(['version', 'edit'], 'source must be "version" or "edit"');

/**
 * Type for validated metadata that matches exactOptionalPropertyTypes requirements.
 */
type ValidatedMetadata = { name?: string; description?: string };

/**
 * Filters undefined values from metadata to satisfy exactOptionalPropertyTypes.
 */
function normalizeMetadata(data?: { name?: string; description?: string }): ValidatedMetadata {
    if (!data) return {};
    const result: ValidatedMetadata = {};
    if (data.name !== undefined) result.name = data.name;
    if (data.description !== undefined) result.description = data.description;
    return result;
}

/**
 * Validates input parameters using valibot schemas.
 * @throws Error with detailed validation message on failure.
 */
function validateInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (!result.success) {
        const messages = result.issues.map(i => i.message).join('; ');
        throw new Error(`TimelineDatabase: Invalid ${fieldName} - ${messages}`);
    }
    return result.output;
}

/**
 * Main thread client for the Timeline Worker.
 * Manages the worker lifecycle and proxies calls to the worker.
 * Handles serialization/deserialization to optimize data transfer.
 * All public methods validate inputs using valibot schemas.
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
        // Validate inputs using valibot
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validSource = validateInput(SourceSchema, source, 'source');

        if (!this.workerProxy) await this.initializeWorker();
        if (!this.workerProxy) return [];

        try {
            // Worker returns an ArrayBuffer (transferred ownership)
            const buffer = await this.workerProxy.getTimeline(validNoteId, validBranchName, validSource);
            return this.deserialize<TimelineEvent[]>(buffer);
        } catch (error) {
            console.error("VC: Failed to get timeline from worker", error);
            return [];
        }
    }

    /**
     * Delegates event generation and storage to the worker.
     * Supports transferring ownership of ArrayBuffers for both requests (inputs) and results (output).
     * Validates all inputs using valibot schemas.
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
        // Validate inputs using valibot
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validSource = validateInput(SourceSchema, source, 'source');
        const validToVersionId = validateInput(VersionIdSchema, toVersionId, 'toVersionId');

        // Normalize metadata to satisfy exactOptionalPropertyTypes
        const validMetadata = normalizeMetadata(metadata);

        // fromVersionId can be null, so only validate if provided
        let validFromVersionId: string | null = null;
        if (fromVersionId !== null) {
            validFromVersionId = validateInput(VersionIdSchema, fromVersionId, 'fromVersionId');
        }

        if (!this.workerProxy) await this.initializeWorker();
        if (!this.workerProxy) throw new Error("Timeline worker unavailable");

        // Prepare transferables for inputs
        // We must wrap the specific arguments that are transferables using Comlink.transfer()
        const c1 = content1 instanceof ArrayBuffer ? transfer(content1, [content1]) : content1;
        const c2 = content2 instanceof ArrayBuffer ? transfer(content2, [content2]) : content2;

        try {
            // Worker returns an ArrayBuffer (transferred ownership)
            const resultBuffer = await this.workerProxy.generateAndStoreEvent(
                validNoteId,
                validBranchName,
                validSource,
                validFromVersionId,
                validToVersionId,
                toVersionTimestamp,
                toVersionNumber,
                c1,
                c2,
                validMetadata
            );

            return this.deserialize<TimelineEvent>(resultBuffer);
        } catch (error) {
            console.error("VC: Failed to generate event in worker", error);
            throw error;
        }
    }

    public async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        // Validate inputs using valibot
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validVersionId = validateInput(VersionIdSchema, versionId, 'versionId');

        // Normalize metadata to satisfy exactOptionalPropertyTypes
        const validData = normalizeMetadata(data);

        if (!this.workerProxy) return;
        await this.workerProxy.updateEventMetadata(validNoteId, validVersionId, validData);
    }

    public async removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void> {
        // Validate inputs using valibot
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');
        const validBranchName = validateInput(BranchNameSchema, branchName, 'branchName');
        const validSource = validateInput(SourceSchema, source, 'source');
        const validVersionId = validateInput(VersionIdSchema, versionId, 'versionId');

        if (!this.workerProxy) return;
        await this.workerProxy.removeEventByVersion(validNoteId, validBranchName, validSource, validVersionId);
    }

    public async clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void> {
        // Validate inputs using valibot
        const validNoteId = validateInput(NoteIdSchema, noteId, 'noteId');

        // source is optional, only validate if provided
        let validSource: 'version' | 'edit' | undefined;
        if (source !== undefined) {
            validSource = validateInput(SourceSchema, source, 'source');
        }

        if (!this.workerProxy) return;
        await this.workerProxy.clearTimelineForNote(validNoteId, validSource);
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
