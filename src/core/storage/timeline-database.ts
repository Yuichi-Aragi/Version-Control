import { Component } from 'obsidian';
import { transfer, type Remote } from 'comlink';
import * as v from 'valibot';
import type { TimelineEvent, TimelineWorkerApi } from '@/types';
import { WorkerManager, WorkerManagerError } from '@/workers';

// Injected by esbuild define
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
        throw new WorkerManagerError(`TimelineDatabase: Invalid ${fieldName} - ${messages}`, 'INVALID_STATE');
    }
    return result.output;
}

/**
 * Specialized worker manager for the Timeline Worker with input validation.
 */
export class TimelineWorkerManager extends WorkerManager<TimelineWorkerApi> {
    private readonly decoder = new TextDecoder('utf-8');

    constructor() {
        super({
            workerString: typeof timelineWorkerString !== 'undefined' ? timelineWorkerString : '',
            workerName: 'Timeline Worker',
            validateOnInit: false, // Validation happens on first operation
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    /**
     * Gets the worker proxy for making API calls.
     * @returns The timeline worker proxy
     */
    public getProxy(): Remote<TimelineWorkerApi> {
        return this.ensureWorker();
    }

    /**
     * Validates and returns a note ID.
     */
    public validateNoteId(noteId: string): string {
        return validateInput(NoteIdSchema, noteId, 'noteId');
    }

    /**
     * Validates and returns a branch name.
     */
    public validateBranchName(branchName: string): string {
        return validateInput(BranchNameSchema, branchName, 'branchName');
    }

    /**
     * Validates and returns a version ID.
     */
    public validateVersionId(versionId: string): string {
        return validateInput(VersionIdSchema, versionId, 'versionId');
    }

    /**
     * Validates and returns a source.
     */
    public validateSource(source: string): 'version' | 'edit' {
        return validateInput(SourceSchema, source, 'source');
    }

    /**
     * Normalizes metadata for exactOptionalPropertyTypes.
     */
    public normalizeMetadata(data?: { name?: string; description?: string }): ValidatedMetadata {
        return normalizeMetadata(data);
    }

    /**
     * Deserializes ArrayBuffer to JSON.
     */
    public deserialize<T>(buffer: ArrayBuffer): T {
        const json = this.decoder.decode(buffer);
        return JSON.parse(json) as T;
    }

    /**
     * Prepares content for transfer (wraps ArrayBuffer in Comlink.transfer).
     */
    public prepareTransferable(
        content: string | ArrayBuffer,
        transfers: ArrayBuffer[]
    ): string | ArrayBuffer {
        if (content instanceof ArrayBuffer) {
            transfers.push(content);
            return transfer(content, transfers);
        }
        return content;
    }
}

/**
 * Error class for TimelineWorkerManager operations.
 */
export class TimelineWorkerError extends WorkerManagerError {
    constructor(
        message: string,
        code: 'INVALID_STATE' | 'WORKER_UNAVAILABLE' | 'VALIDATION_FAILED' | 'INIT_FAILED',
        context?: Record<string, unknown>
    ) {
        super(message, code, context);
        this.name = 'TimelineWorkerError';
    }
}

/**
 * Main thread client for the Timeline Worker.
 * Maintains backward compatibility with the original TimelineDatabase class.
 * Manages the worker lifecycle and proxies calls to the worker.
 * Handles serialization/deserialization to optimize data transfer.
 * 
 * @deprecated Use TimelineWorkerManager directly for new code
 */
export class TimelineDatabase extends Component {
    private readonly workerManager: TimelineWorkerManager;

    constructor() {
        super();
        this.workerManager = new TimelineWorkerManager();
    }

    /**
     * Initializes the timeline database and worker.
     */
    public initialize(): void {
        this.workerManager.initialize();
    }

    /**
     * Gets the timeline for a note.
     */
    public async getTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<TimelineEvent[]> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validBranchName = this.workerManager.validateBranchName(branchName);
        const validSource = this.workerManager.validateSource(source);

        if (!this.workerManager.isActive()) {
            this.workerManager.initialize();
        }
        if (!this.workerManager.isActive()) {
            return [];
        }

        try {
            const proxy = this.workerManager.getProxy();
            const buffer = await proxy.getTimeline(validNoteId, validBranchName, validSource);
            return this.workerManager.deserialize<TimelineEvent[]>(buffer);
        } catch (error) {
            console.error("VC: Failed to get timeline from worker", error);
            return [];
        }
    }

    /**
     * Generates and stores a timeline event.
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
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validBranchName = this.workerManager.validateBranchName(branchName);
        const validSource = this.workerManager.validateSource(source);
        const validToVersionId = this.workerManager.validateVersionId(toVersionId);
        const validMetadata = this.workerManager.normalizeMetadata(metadata);
        let validFromVersionId: string | null = null;
        if (fromVersionId !== null) {
            validFromVersionId = this.workerManager.validateVersionId(fromVersionId);
        }

        if (!this.workerManager.isActive()) {
            this.workerManager.initialize();
        }
        if (!this.workerManager.isActive()) {
            throw new TimelineWorkerError("Timeline worker unavailable", 'WORKER_UNAVAILABLE');
        }

        const proxy = this.workerManager.getProxy();
        const c1 = this.workerManager.prepareTransferable(content1, []);
        const c2 = this.workerManager.prepareTransferable(content2, []);

        const resultBuffer = await proxy.generateAndStoreEvent(
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

        return this.workerManager.deserialize<TimelineEvent>(resultBuffer);
    }

    /**
     * Updates event metadata.
     */
    public async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validVersionId = this.workerManager.validateVersionId(versionId);
        const validData = this.workerManager.normalizeMetadata(data);

        if (!this.workerManager.isActive()) return;
        
        const proxy = this.workerManager.getProxy();
        await proxy.updateEventMetadata(validNoteId, validVersionId, validData);
    }

    /**
     * Removes an event by version.
     */
    public async removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validBranchName = this.workerManager.validateBranchName(branchName);
        const validSource = this.workerManager.validateSource(source);
        const validVersionId = this.workerManager.validateVersionId(versionId);

        if (!this.workerManager.isActive()) return;
        
        const proxy = this.workerManager.getProxy();
        await proxy.removeEventByVersion(validNoteId, validBranchName, validSource, validVersionId);
    }

    /**
     * Clears timeline for a note.
     */
    public async clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        
        if (!this.workerManager.isActive()) return;
        
        const proxy = this.workerManager.getProxy();
        await proxy.clearTimelineForNote(validNoteId, source);
    }

    /**
     * Clears all timeline data.
     */
    public async clearAll(): Promise<void> {
        if (!this.workerManager.isActive()) return;
        
        const proxy = this.workerManager.getProxy();
        await proxy.clearAll();
    }

    /**
     * Terminates the worker and cleans up resources.
     */
    public terminate(): void {
        this.workerManager.terminate();
    }

    override onunload(): void {
        this.terminate();
    }
}
