import { App, TFile, Component } from 'obsidian';
import { Change } from 'diff';
import { VersionManager } from '../core/version-manager';
import { VersionHistoryEntry, DiffTarget } from '../types';
import { PluginEvents } from '../core/plugin-events';
import { diffWorkerString } from '../workers/diff.worker.string';

export class DiffManager extends Component {
    private app: App;
    private versionManager: VersionManager;
    private eventBus: PluginEvents;
    private diffCache: Map<string, Change[]> = new Map();

    constructor(app: App, versionManager: VersionManager, eventBus: PluginEvents) {
        super();
        this.app = app;
        this.versionManager = versionManager;
        this.eventBus = eventBus;
    }

    onload() {
        this.registerEvent(this.eventBus.on('version-saved', this.handleHistoryChange));
        this.registerEvent(this.eventBus.on('version-deleted', this.handleHistoryChange));
        this.registerEvent(this.eventBus.on('history-deleted', this.handleHistoryChange));
        console.log("Version Control: DiffManager is now listening for history changes.");
    }

    onunload() {
        this.diffCache.clear();
        console.log("Version Control: DiffManager unloaded, cache cleared.");
    }

    private handleHistoryChange = (noteId: string): void => {
        this.invalidateCacheForNote(noteId);
    }

    public generateDiff(
        noteId: string,
        version1: VersionHistoryEntry,
        version2: DiffTarget
    ): Promise<Change[]> {
        return new Promise(async (resolve, reject) => {
            const cacheKey = this.getCacheKey(noteId, version1.id, version2.id);

            if (version2.id !== 'current' && this.diffCache.has(cacheKey)) {
                resolve(this.diffCache.get(cacheKey)!);
                return;
            }

            let worker: Worker | null = null;
            let workerUrl: string | null = null;

            const cleanup = () => {
                if (worker) {
                    worker.terminate();
                    worker = null;
                }
                if (workerUrl) {
                    URL.revokeObjectURL(workerUrl);
                    workerUrl = null;
                }
            };

            try {
                const content1 = await this.versionManager.getVersionContent(noteId, version1.id);
                let content2: string | null;

                if (version2.id === 'current') {
                    const file = this.app.vault.getAbstractFileByPath(version2.notePath);
                    if (file instanceof TFile) {
                        content2 = await this.app.vault.read(file);
                    } else {
                        throw new Error(`Could not find the current note file at path "${version2.notePath}" to generate diff.`);
                    }
                } else {
                    content2 = await this.versionManager.getVersionContent(noteId, version2.id);
                }

                if (content1 === null || content2 === null) {
                    throw new Error("Could not retrieve content for one or both versions.");
                }

                // Create worker from blob containing the bundled worker code
                const blob = new Blob([diffWorkerString], { type: 'application/javascript' });
                workerUrl = URL.createObjectURL(blob);
                worker = new Worker(workerUrl);

                worker.onmessage = (event: MessageEvent<{ status: 'success' | 'error', changes?: Change[], error?: any }>) => {
                    cleanup();
                    if (event.data.status === 'success' && event.data.changes) {
                        if (version2.id !== 'current') {
                            this.diffCache.set(cacheKey, event.data.changes);
                        }
                        resolve(event.data.changes);
                    } else {
                        console.error("Version Control: Diff worker returned an error.", event.data.error);
                        reject(new Error(event.data.error?.message || "Unknown worker error"));
                    }
                };

                worker.onerror = (error: ErrorEvent) => {
                    cleanup();
                    console.error("Version Control: An error occurred in the diff worker.", error);
                    reject(error);
                };
                
                worker.onmessageerror = (event: MessageEvent) => {
                    cleanup();
                    console.error("Version Control: A message error occurred in the diff worker.", event);
                    reject(new Error("Worker message error"));
                };

                // Start the worker by posting the content to it
                worker.postMessage({ content1, content2 });

            } catch (error) {
                cleanup();
                console.error("Version Control: Error setting up diff worker", error);
                reject(error);
            }
        });
    }

    private getCacheKey(noteId: string, id1: string, id2: string): string {
        const sortedIds = [id1, id2].sort();
        return `${noteId}:${sortedIds[0]}:${sortedIds[1]}`;
    }

    public invalidateCacheForNote(noteId: string): void {
        const keysToDelete = [];
        for (const key of this.diffCache.keys()) {
            if (key.startsWith(`${noteId}:`)) {
                keysToDelete.push(key);
            }
        }
        if (keysToDelete.length > 0) {
            keysToDelete.forEach(key => this.diffCache.delete(key));
            console.log(`Version Control: Invalidated ${keysToDelete.length} diff cache entries for note ${noteId}.`);
        }
    }
}
