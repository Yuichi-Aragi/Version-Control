import { injectable } from 'inversify';
import { wrap, releaseProxy, transfer, type Remote } from 'comlink';
import { orderBy } from 'es-toolkit';
import { map } from 'es-toolkit/compat';
import type { EditWorkerApi, NoteManifest, VersionHistoryEntry } from '@/types';

declare const editHistoryWorkerString: string;

@injectable()
export class EditHistoryManager {
    private worker: Worker | null = null;
    private workerProxy: Remote<EditWorkerApi> | null = null;
    private workerUrl: string | null = null;
    private decoder = new TextDecoder('utf-8');
    private encoder = new TextEncoder();

    constructor() {}

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

        let targetBranch = branchName;
        if (!targetBranch) {
            const manifest = await this.getEditManifest(noteId);
            if (!manifest) return null;
            // Try to find which branch contains this editId
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

    public async deleteBranch(noteId: string, branchName: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.deleteBranch(noteId, branchName);
    }

    public async renameEdit(noteId: string, oldEditId: string, newEditId: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.renameEdit(noteId, oldEditId, newEditId);
    }

    public async renameNote(oldNoteId: string, newNoteId: string, newPath: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.renameNote(oldNoteId, newNoteId, newPath);
    }

    public async updateNotePath(noteId: string, newPath: string): Promise<void> {
        if (!this.workerProxy) this.initializeWorker();
        if (!this.workerProxy) return;
        await this.workerProxy.updateNotePath(noteId, newPath);
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
