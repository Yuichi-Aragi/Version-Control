/**
 * DiffManager - Lean orchestrator for diff operations
 * Uses WorkerManager for centralized worker lifecycle management.
 */

import { App, TFile, Component, MarkdownView } from 'obsidian';
import { VersionManager } from '@/core';
import type { DiffTarget, DiffType, Change } from '@/types';
import { PluginEvents } from '@/core';
import { VersionContentRepository } from '@/core';
import { DiffWorkerManager, WorkerHealthMonitor } from '@/services/diff-manager/workers';
import { DiffCache, CacheKeyGenerator } from '@/services/diff-manager/cache';
import { DiffComputer, DiffValidator } from '@/services/diff-manager/operations';
import { DiffManagerError, type WorkerStatus, type CacheStats } from '@/services/diff-manager/types';
import { WORKER_TIMEOUT, DIFF_CACHE_CAPACITY } from '@/services/diff-manager/config';

export class DiffManager extends Component {
    private readonly diffCache: DiffCache;
    private readonly workerManager: DiffWorkerManager;
    private readonly workerHealthMonitor: WorkerHealthMonitor;
    private readonly diffComputer: DiffComputer;
    private isInitializing = false;
    private pendingOperations = new Set<Promise<unknown>>();

    constructor(
        private readonly app: App,
        private readonly versionManager: VersionManager,
        private readonly contentRepo: VersionContentRepository,
        private readonly eventBus: PluginEvents
    ) {
        super();
        this.diffCache = new DiffCache();
        this.workerManager = new DiffWorkerManager();
        this.workerHealthMonitor = new WorkerHealthMonitor();
        this.diffComputer = new DiffComputer();
    }

    override onload(): void {
        try {
            this.registerEventListeners();
            this.initializeWorker();
            this.register(() => this.cleanup());
        } catch (error) {
            console.error("Version Control: Failed to initialize DiffManager", error);
            this.cleanup();
            throw new DiffManagerError(
                `DiffManager initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'INIT_FAILED',
                { originalError: error }
            );
        }
    }

    private registerEventListeners(): void {
        const events = ['version-saved', 'version-deleted', 'history-deleted'] as const;

        for (const event of events) {
            this.eventBus.on(event, this.handleHistoryChange);
            this.register(() => this.eventBus.off(event, this.handleHistoryChange));
        }
    }

    private async initializeWorker(): Promise<void> {
        if (this.workerManager.isInitialized() || this.isInitializing) {
            return;
        }

        this.isInitializing = true;

        try {
            await this.workerManager.initializeAsync();
        } catch (error) {
            console.error("Version Control: Failed to initialize the diff worker", error);
            this.workerManager.terminate();
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    private handleHistoryChange = (noteId: string): void => {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            console.warn("Version Control: Received invalid noteId in handleHistoryChange");
            return;
        }
        this.invalidateCacheForNote(noteId);
    }

    public async getContent(noteId: string, target: DiffTarget): Promise<string | ArrayBuffer> {
        if (typeof noteId !== 'string' || noteId.trim() === '') {
            throw new DiffManagerError("Invalid noteId: must be a non-empty string", 'INVALID_NOTE_ID');
        }
        if (!target || typeof target !== 'object' || typeof target.id !== 'string' || target.id.trim() === '') {
            throw new DiffManagerError("Invalid target or target.id", 'INVALID_TARGET');
        }

        if (target.id === 'current') {
            if (!target.notePath || typeof target.notePath !== 'string') {
                throw new DiffManagerError("Current version requires a valid notePath", 'INVALID_NOTE_PATH');
            }

            const file = this.app.vault.getAbstractFileByPath(target.notePath);
            if (!(file instanceof TFile)) {
                throw new DiffManagerError(`Could not find current note file at path "${target.notePath}"`, 'FILE_NOT_FOUND');
            }

            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeMarkdownView?.file?.path === file.path && activeMarkdownView.getMode() === 'source') {
                return activeMarkdownView.editor.getValue();
            } else {
                // Optimize reading file on disk.
                // For .base files, use adapter.read() to get string content.
                if (file.extension === 'base') {
                    return await this.app.vault.adapter.read(file.path);
                }
                // For other files (presumably binary or large), use readBinary
                return await this.app.vault.adapter.readBinary(file.path);
            }
        } else {
            // Try reading binary first for optimization
            const buffer = await this.contentRepo.readBinary(noteId, target.id);
            if (buffer) return buffer;

            // Fallback to string read via VersionManager if binary fails (e.g. legacy logic)
            const content = await this.versionManager.getVersionContent(noteId, target.id);
            if (content === null) {
                throw new DiffManagerError(`Could not retrieve content for version ${target.id}`, 'VERSION_CONTENT_NOT_FOUND');
            }
            return content;
        }
    }

    public async computeDiff(
        noteId: string,
        version1Id: string,
        version2Id: string,
        content1: string | ArrayBuffer,
        content2: string | ArrayBuffer,
        diffType: DiffType
    ): Promise<Change[]> {
        DiffValidator.validateParams(noteId, version1Id, version2Id, diffType);
        DiffValidator.validateContentSize(content1, content2);

        const cacheKey = CacheKeyGenerator.generate(noteId, version1Id, version2Id, diffType);

        if (version2Id !== 'current' && await this.diffCache.has(cacheKey)) {
            const cachedResult = await this.diffCache.get(cacheKey);
            if (cachedResult) return cachedResult;
        }

        if (!this.workerManager.isActive()) {
            await this.initializeWorker();
        }
        if (!this.workerManager.isActive()) {
            throw new DiffManagerError("Diff worker unavailable", 'WORKER_UNAVAILABLE');
        }

        if (!this.workerManager.isHealthy()) {
            console.warn("Version Control: Worker health check failed, restarting worker");
            await this.restartWorker();
            if (!this.workerManager.isActive()) {
                throw new DiffManagerError("Diff worker unavailable after restart", 'WORKER_UNAVAILABLE');
            }
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new DiffManagerError('Diff operation timed out', 'OPERATION_TIMEOUT')), WORKER_TIMEOUT);
        });

        try {
            const diffOperation = this.diffComputer.compute(
                this.workerManager.getProxy(),
                content1,
                content2,
                diffType,
                version2Id,
                cacheKey,
                (duration) => {
                    this.workerHealthMonitor.recordOperation(duration);
                    this.workerManager.recordOperation(duration);
                },
                () => {
                    this.workerHealthMonitor.recordError();
                    this.workerManager.recordError();
                },
                () => this.restartWorker(),
                (key, value) => this.diffCache.set(key, value)
            );
            return await Promise.race([diffOperation, timeoutPromise]);
        } catch (error) {
            this.workerHealthMonitor.recordError();
            this.workerManager.recordError();
            throw error;
        }
    }

    public async invalidateCacheForNote(noteId: string): Promise<void> {
        if (typeof noteId !== 'string' || noteId.trim() === '') return;

        const prefix = CacheKeyGenerator.getNotePrefixPattern(noteId);
        const keysToDelete: string[] = [];

        try {
            const keys = await this.diffCache.keys();
            for (const key of keys) {
                if (typeof key === 'string' && key.startsWith(prefix)) {
                    keysToDelete.push(key);
                }
            }
            for (const key of keysToDelete) {
                await this.diffCache.delete(key);
            }
        } catch (error) {
            console.error("Version Control: Error invalidating cache for note", error);
        }
    }

    private cleanup(): void {
        Promise.allSettled(Array.from(this.pendingOperations))
            .then(() => {
                this.workerManager.terminate();
                return this.diffCache.clear();
            })
            .catch(error => console.error("Version Control: Error during cleanup", error));
    }

    public async restartWorker(): Promise<void> {
        try {
            this.workerManager.terminate();
            await this.initializeWorker();
        } catch (error) {
            console.error("Version Control: Error restarting worker", error);
            throw new DiffManagerError('Worker restart failed', 'WORKER_RESTART_FAILED', { originalError: error });
        }
    }

    public getWorkerStatus(): WorkerStatus {
        const status = this.workerManager.getStatus();
        return {
            isInitialized: status.isInitialized,
            isActive: status.isActive,
            isHealthy: status.isHealthy,
            healthStats: status.healthStats,
        };
    }

    public async getCacheStats(): Promise<CacheStats> {
        try {
            const stats = await this.diffCache.getStats();
            return {
                size: stats.size,
                capacity: stats.capacity,
                utilization: stats.utilization,
            };
        } catch (error) {
            console.error("Version Control: Error getting cache stats", error);
            return { size: 0, capacity: DIFF_CACHE_CAPACITY, utilization: 0 };
        }
    }
}
