import { injectable, inject } from 'inversify';
import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import { map, orderBy } from 'lodash-es';
import type { EditWorkerApi, NoteManifest, VersionHistoryEntry } from '../types';
import { TYPES } from '../types/inversify.types';
import type VersionControlPlugin from '../main';
import { produce } from 'immer';

declare const editHistoryWorkerString: string;

@injectable()
export class EditHistoryManager {
    private worker: Worker | null = null;
    private workerProxy: Remote<EditWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private decoder = new TextDecoder('utf-8');
    private encoder = new TextEncoder();

    constructor(
        @inject(TYPES.Plugin) private plugin: VersionControlPlugin
    ) {}

    public initialize(): void {
        this.initializeWorker();
    }

    private initializeWorker(): void {
        if (this.worker) return;

        try {
            if (typeof editHistoryWorkerString === 'undefined' || editHistoryWorkerString === '') {
                console.error("Version Control: Edit History worker code missing.");
                return;
            }
            const blob = new Blob([editHistoryWorkerString], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.workerProxy = wrap<EditWorkerApi>(this.worker);
        } catch (error) {
            console.error("Version Control: Failed to initialize Edit History worker", error);
        }
    }

    public async saveEdit(noteId: string, branchName: string, editId: string, content: string, manifest: NoteManifest): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) throw new Error("Edit History Worker not available");

        // Encode string to ArrayBuffer for efficient transfer
        const buffer = this.encoder.encode(content).buffer as ArrayBuffer;
        
        // Transfer the buffer to the worker
        await this.workerProxy.saveEdit(noteId, branchName, editId, transfer(buffer, [buffer]), manifest);
    }

    public async getEditContent(noteId: string, editId: string, branchName?: string): Promise<string | null> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return null;

        // If branchName is not provided, we need to find it from manifest (legacy support or safety)
        // However, for efficiency, callers should provide it.
        let targetBranch = branchName;
        if (!targetBranch) {
            const manifest = await this.getEditManifest(noteId);
            if (!manifest) return null;
            // Try to find which branch contains this editId
            // This is slow but necessary if branch is unknown
            for (const [bName, branch] of Object.entries(manifest.branches)) {
                if (branch.versions[editId]) {
                    targetBranch = bName;
                    break;
                }
            }
        }

        if (!targetBranch) return null;

        const buffer = await this.workerProxy.getEditContent(noteId, targetBranch, editId);
        if (!buffer) return null;

        return this.decoder.decode(buffer);
    }

    public async getEditManifest(noteId: string): Promise<NoteManifest | null> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return null;
        return await this.workerProxy.getEditManifest(noteId);
    }

    public async getEditHistory(noteId: string): Promise<VersionHistoryEntry[]> {
        const manifest = await this.getEditManifest(noteId);
        if (!manifest) return [];

        const branchName = manifest.currentBranch;
        const currentBranch = manifest.branches[branchName];
        if (!currentBranch || !currentBranch.versions) return [];

        const history = map(currentBranch.versions, (data, id) => ({
            id,
            noteId,
            notePath: manifest.notePath,
            branchName,
            versionNumber: data.versionNumber,
            timestamp: data.timestamp,
            size: data.size,
            ...(data.name && { name: data.name }),
            ...(data.description && { description: data.description }),
            wordCount: data.wordCount,
            wordCountWithMd: data.wordCountWithMd,
            charCount: data.charCount,
            charCountWithMd: data.charCountWithMd,
            lineCount: data.lineCount,
            lineCountWithoutMd: data.lineCountWithoutMd,
        }));

        return orderBy(history, ['versionNumber'], ['desc']);
    }

    public async saveEditManifest(noteId: string, manifest: NoteManifest): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.saveEditManifest(noteId, manifest);
    }

    public async deleteEdit(noteId: string, branchName: string, editId: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.deleteEdit(noteId, branchName, editId);
    }

    public async deleteNoteHistory(noteId: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.deleteNoteHistory(noteId);
    }

    public async renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.renameEdit(noteId, oldEditId, newEditId);
    }

    public async renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;

        // 1. Update IndexedDB via Worker
        await this.workerProxy.renameNote(oldNoteId, newNoteId, newPath);

        // 2. Update Central Edit Manifest in Settings
        // We do this after DB update to ensure data is moved first.
        this.plugin.settings = produce(this.plugin.settings, draft => {
            if (draft.editHistoryManifest?.notes[oldNoteId]) {
                const entry = draft.editHistoryManifest.notes[oldNoteId];
                if (entry) {
                    // Create new entry copying old data but updating path
                    draft.editHistoryManifest.notes[newNoteId] = {
                        ...entry,
                        notePath: newPath,
                        lastModified: new Date().toISOString()
                    };
                    // Delete old entry
                    delete draft.editHistoryManifest.notes[oldNoteId];
                }
            }
        });
        await this.plugin.saveSettings();
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;

        // 1. Update IndexedDB via Worker
        await this.workerProxy.updateNotePath(noteId, newPath);

        // 2. Update Central Edit Manifest in Settings
        this.plugin.settings = produce(this.plugin.settings, draft => {
            if (draft.editHistoryManifest?.notes[noteId]) {
                const entry = draft.editHistoryManifest.notes[noteId];
                if (entry) {
                    entry.notePath = newPath;
                    entry.lastModified = new Date().toISOString();
                }
            }
        });
        await this.plugin.saveSettings();
    }

    // Central Manifest Management (stored in Plugin Settings)
    public async registerNoteInCentralManifest(noteId: string, notePath: string): Promise<void> {
        const now = new Date().toISOString();
        
        // FIX: Use produce on the root settings object to respect immutability.
        // Direct assignment to `this.plugin.settings.editHistoryManifest` fails if settings is frozen.
        this.plugin.settings = produce(this.plugin.settings, draft => {
            // Ensure editHistoryManifest exists
            if (!draft.editHistoryManifest) {
                draft.editHistoryManifest = { version: "1.0.0", notes: {} };
            }
            
            draft.editHistoryManifest.notes[noteId] = {
                notePath,
                manifestPath: 'indexeddb', // Placeholder, as it is in IDB
                createdAt: now,
                lastModified: now
            };
        });

        await this.plugin.saveSettings();
    }

    public async unregisterNoteFromCentralManifest(noteId: string): Promise<void> {
        // Check existence first to avoid unnecessary writes/updates
        if (!this.plugin.settings.editHistoryManifest?.notes[noteId]) return;

        // FIX: Use produce on the root settings object.
        this.plugin.settings = produce(this.plugin.settings, draft => {
            if (draft.editHistoryManifest?.notes[noteId]) {
                delete draft.editHistoryManifest.notes[noteId];
            }
        });
        
        await this.plugin.saveSettings();
    }

    public terminate(): void {
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
    }
}
