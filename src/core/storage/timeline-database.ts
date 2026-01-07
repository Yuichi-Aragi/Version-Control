import { Component } from 'obsidian';
import { transfer } from 'comlink';
import * as v from 'valibot';
import type { TimelineEvent, TimelineWorkerApi } from '@/types';
import { WorkerManager, WorkerManagerError } from '@/workers';

// Injected by esbuild define
declare const timelineWorkerString: string;

// ... (Validation Schemas and helper functions remain unchanged) ...
const NoteIdSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(500));
const BranchNameSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(255));
const VersionIdSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(500));
const SourceSchema = v.picklist(['version', 'edit']);

type ValidatedMetadata = { name?: string; description?: string };

function normalizeMetadata(data?: { name?: string; description?: string }): ValidatedMetadata {
    if (!data) return {};
    const result: ValidatedMetadata = {};
    if (data.name !== undefined) result.name = data.name;
    if (data.description !== undefined) result.description = data.description;
    return result;
}

function validateInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (!result.success) {
        throw new WorkerManagerError(`TimelineDatabase: Invalid ${fieldName}`, 'INVALID_INPUT');
    }
    return result.output;
}

/**
 * Specialized worker manager for the Timeline Worker.
 */
export class TimelineWorkerManager extends WorkerManager<TimelineWorkerApi> {
    private readonly decoder = new TextDecoder('utf-8');

    constructor() {
        super({
            workerString: typeof timelineWorkerString !== 'undefined' ? timelineWorkerString : '',
            workerName: 'Timeline Worker',
            validateOnInit: false,
            maxConsecutiveErrors: 3,
            errorResetTime: 60000,
        });
    }

    // Expose validation helpers
    public validateNoteId(id: string) { return validateInput(NoteIdSchema, id, 'noteId'); }
    public validateBranchName(name: string) { return validateInput(BranchNameSchema, name, 'branchName'); }
    public validateVersionId(id: string) { return validateInput(VersionIdSchema, id, 'versionId'); }
    public validateSource(s: string) { return validateInput(SourceSchema, s, 'source'); }
    public normalizeMetadata(d?: {name?: string, description?: string}) { return normalizeMetadata(d); }

    public deserialize<T>(buffer: ArrayBuffer): T {
        return JSON.parse(this.decoder.decode(buffer)) as T;
    }

    /**
     * Prepares content for zero-copy transfer.
     * 
     * CRITICAL FIX: This method must NOT use a shared/accumulated transfer array.
     * Comlink aggregates transfer lists from all arguments. If we pass the same array reference
     * or accumulate buffers in a shared array, Comlink will see duplicate ArrayBuffers in the 
     * final transfer list, causing "DataCloneError: ArrayBuffer at index X is a duplicate".
     * 
     * Instead, we attach a specific, isolated transfer list to each transferred object.
     */
    public prepareTransferable(content: string | ArrayBuffer): string | ArrayBuffer {
        if (content instanceof ArrayBuffer) {
            return transfer(content, [content]);
        }
        return content;
    }
}

/**
 * Main thread client for the Timeline Worker.
 * Uses the robust execute() pattern.
 */
export class TimelineDatabase extends Component {
    private readonly workerManager: TimelineWorkerManager;

    constructor() {
        super();
        this.workerManager = new TimelineWorkerManager();
    }

    public initialize(): void {
        this.workerManager.initialize();
    }

    public async getTimeline(noteId: string, branchName: string, source: 'version' | 'edit'): Promise<TimelineEvent[]> {
        try {
            const validNoteId = this.workerManager.validateNoteId(noteId);
            const validBranchName = this.workerManager.validateBranchName(branchName);
            const validSource = this.workerManager.validateSource(source);

            const buffer = await this.workerManager.execute(
                (api) => api.getTimeline(validNoteId, validBranchName, validSource),
                { timeout: 15000, retry: true }
            );
            
            return this.workerManager.deserialize<TimelineEvent[]>(buffer);
        } catch (error) {
            console.error("VC: Failed to get timeline", error);
            return []; // Fail safe for UI
        }
    }

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
        const validFromVersionId = fromVersionId ? this.workerManager.validateVersionId(fromVersionId) : null;

        const resultBuffer = await this.workerManager.execute(
            (api) => {
                // Prepare transferables independently to avoid duplicate transfer list entries
                const c1 = this.workerManager.prepareTransferable(content1);
                const c2 = this.workerManager.prepareTransferable(content2);
                
                return api.generateAndStoreEvent(
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
            },
            { timeout: 30000, retry: true } // Diffing can be slow
        );

        return this.workerManager.deserialize<TimelineEvent>(resultBuffer);
    }

    public async updateEventMetadata(noteId: string, versionId: string, data: { name?: string; description?: string }): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validVersionId = this.workerManager.validateVersionId(versionId);
        const validData = this.workerManager.normalizeMetadata(data);

        await this.workerManager.execute(
            (api) => api.updateEventMetadata(validNoteId, validVersionId, validData),
            { timeout: 5000, retry: true }
        );
    }

    public async removeEventByVersion(noteId: string, branchName: string, source: 'version' | 'edit', versionId: string): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        const validBranchName = this.workerManager.validateBranchName(branchName);
        const validSource = this.workerManager.validateSource(source);
        const validVersionId = this.workerManager.validateVersionId(versionId);

        await this.workerManager.execute(
            (api) => api.removeEventByVersion(validNoteId, validBranchName, validSource, validVersionId),
            { timeout: 5000, retry: true }
        );
    }

    public async clearTimelineForNote(noteId: string, source?: 'version' | 'edit'): Promise<void> {
        const validNoteId = this.workerManager.validateNoteId(noteId);
        await this.workerManager.execute(
            (api) => api.clearTimelineForNote(validNoteId, source),
            { timeout: 10000, retry: true }
        );
    }

    public async clearAll(): Promise<void> {
        await this.workerManager.execute(
            (api) => api.clearAll(),
            { timeout: 30000, retry: false }
        );
    }

    public terminate(): void {
        this.workerManager.terminate();
    }

    override onunload(): void {
        this.terminate();
    }
}
