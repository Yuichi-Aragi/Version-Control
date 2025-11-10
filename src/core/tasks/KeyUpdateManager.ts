import { App, TFile, Notice, MarkdownView, type Editor } from 'obsidian';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../types/inversify.types';
import type VersionControlPlugin from '../../main';
import { PathService } from '../storage/path-service';
import { CentralManifestRepository } from '../storage/central-manifest-repository';
import { QueueService } from '../../services/queue-service';
import { isPathAllowed } from '../../utils/path-filter';
import type { AppStore } from '../../state/store';
import { actions } from '../../state/appSlice';

interface UpdateResult {
    success: boolean;
    path: string;
    error?: string;
}

// Define a type for file filters to improve type safety
interface FileFilters {
    keyUpdateFilters: string[];
    globalPathFilters: string[];
}

// Define a type for file operation context
interface FileOperationContext {
    isHidden: boolean;
    isEditorActive: boolean;
    file?: TFile | undefined;
}

@injectable()
export class KeyUpdateManager {
    // Base per-file timeout for read/write ops
    private static readonly FILE_OP_TIMEOUT_MS = 30_000; // 30s
    // Max concurrency thresholds (desktop vs mobile)
    private static readonly DESKTOP_CONCURRENCY = 15;
    private static readonly MOBILE_CONCURRENCY = 10;
    // Cache for regex patterns to avoid recreation
    private static readonly REGEX_CACHE = new Map<string, RegExp>();
    // Cache for frontmatter end indices to avoid recalculation
    private static readonly FRONTMATTER_CACHE = new Map<string, number>();

    constructor(
        @inject(TYPES.Plugin) private readonly plugin: VersionControlPlugin,
        @inject(TYPES.App) private readonly app: App,
        @inject(TYPES.Store) private readonly store: AppStore,
        @inject(TYPES.PathService) private readonly pathService: PathService,
        @inject(TYPES.CentralManifestRepo) private readonly centralManifestRepository: CentralManifestRepository,
        @inject(TYPES.QueueService) private readonly queueService: QueueService
    ) {
        // Defensive injection checks
        if (!this.plugin) throw new Error('KeyUpdateManager: plugin missing');
        if (!this.app) throw new Error('KeyUpdateManager: app missing');
        if (!this.store) throw new Error('KeyUpdateManager: store missing');
        if (!this.pathService) throw new Error('KeyUpdateManager: pathService missing');
        if (!this.centralManifestRepository) throw new Error('KeyUpdateManager: centralManifestRepository missing');
        if (!this.queueService) throw new Error('KeyUpdateManager: queueService missing');
    }

    /**
     * Public API - drop-in replacement for existing updateAllKeys.
     */
    public async updateAllKeys(oldKey: string, newKey: string): Promise<void> {
        try {
            const validationError = this.validateKeys(oldKey, newKey);
            if (validationError) {
                new Notice(`Key update aborted: ${validationError}`, 8000);
                console.warn('KeyUpdateManager: validation failed', validationError);
                return;
            }

            const dbPath = this.safeGetSetting(() => this.plugin.settings.databasePath, '');
            const filters = this.getFileFilters();
            const vaultFiles = this.findVaultFilesToUpdate(oldKey, dbPath, filters);

            const dbNotes = await this.safeGetAllNotesFromRepo();
            const dbNoteIds = Object.keys(dbNotes ?? {});

            // Calculate total files for progress tracking
            const totalDbFiles = await this.calculateTotalDbFiles(dbNoteIds);
            const totalFiles = vaultFiles.length + totalDbFiles;
            
            this.store.dispatch(actions.startKeyUpdate({ total: totalFiles }));

            // Process files with optimized concurrency
            const results = await this.processFilesWithConcurrency(vaultFiles, dbNoteIds, oldKey, newKey);

            this.store.dispatch(actions.endKeyUpdate());

            // Report results
            this.reportUpdateResults(results);
        } catch (outerErr) {
            try { this.store.dispatch(actions.endKeyUpdate()); } catch (_) { /* best effort */ }
            const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
            console.error('Unhandled error in updateAllKeys', outerErr);
            new Notice(`Unexpected error during key update: ${msg}`, 0);
        }
    }

    // -------------------------
    // Discovery helpers
    // -------------------------

    private getFileFilters(): FileFilters {
        return {
            keyUpdateFilters: this.safeGetSetting(() => this.plugin.settings.keyUpdatePathFilters, []),
            globalPathFilters: this.safeGetSetting(() => this.plugin.settings.pathFilters, [])
        };
    }

    private findVaultFilesToUpdate(
        oldKey: string,
        dbPath: string,
        filters: FileFilters
    ): TFile[] {
        const allMarkdownFiles = this.safeGetMarkdownFiles();
        const normalizedDbPathPrefix = (typeof dbPath === 'string' && dbPath.length > 0) ? (dbPath + '/') : '';

        return allMarkdownFiles.filter(file => {
            if (!file || !file.path) return false;

            // Skip files inside plugin database folder
            if (normalizedDbPathPrefix && file.path.startsWith(normalizedDbPathPrefix)) return false;

            // Honor per-key-update filters
            if (!isPathAllowed(file.path, { pathFilters: filters.keyUpdateFilters })) return false;

            // Honor global path filters
            if (!isPathAllowed(file.path, { pathFilters: filters.globalPathFilters })) return false;

            // Quick frontmatter check in metadata cache
            const cache = this.app.metadataCache.getFileCache(file);
            return !!(cache?.frontmatter && Object.prototype.hasOwnProperty.call(cache.frontmatter, oldKey));
        });
    }

    private async calculateTotalDbFiles(dbNoteIds: string[]): Promise<number> {
        let totalDbFiles = 0;
        
        // Process in batches to avoid overwhelming the system
        const batchSize = 50;
        for (let i = 0; i < dbNoteIds.length; i += batchSize) {
            const batch = dbNoteIds.slice(i, i + batchSize);
            const batchPromises = batch.map(async (noteId) => {
                try {
                    const notePath = this.pathService.getNoteVersionsPath(noteId);
                    const listResult = await this.safeAdapterList(notePath);
                    return (listResult?.files ?? []).filter((f): f is string => 
                        typeof f === 'string' && f.endsWith('.md')
                    ).length;
                } catch (e) {
                    // Tolerate missing folder
                    console.info(`No versions for noteId=${noteId}`, e);
                    return 0;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            totalDbFiles += batchResults.reduce((sum, count) => sum + count, 0);
        }
        
        return totalDbFiles;
    }

    private async processFilesWithConcurrency(
        vaultFiles: TFile[],
        dbNoteIds: string[],
        oldKey: string,
        newKey: string
    ): Promise<UpdateResult[]> {
        const results: UpdateResult[] = [];
        let processedCount = 0;
        
        const updateProgress = (filePath: string): void => {
            processedCount++;
            try {
                this.store.dispatch(actions.updateKeyUpdateProgress({
                    processed: processedCount,
                    message: `Processing: ${filePath}`,
                }));
            } catch (e) {
                console.error('Failed to dispatch progress update', e);
            }
        };

        // Build tasks for concurrency runner
        const tasks: Array<() => Promise<void>> = [];

        // Add vault file tasks
        for (const file of vaultFiles) {
            if (!file || !file.path) continue;
            tasks.push(async () => {
                const res = await this.updateVaultFile(file, oldKey, newKey);
                results.push(res);
                updateProgress(file.path);
            });
        }

        // Add DB file tasks
        for (const noteId of dbNoteIds) {
            if (!noteId) continue;
            tasks.push(async () => {
                const dbResults = await this.updateDbFilesForNote(noteId, oldKey, newKey);
                for (const r of dbResults) {
                    results.push(r);
                    updateProgress(r.path);
                }
            });
        }

        // Execute with appropriate concurrency
        const concurrency = this.determineConcurrency();
        await this.runTasksWithConcurrency(tasks, concurrency);

        return results;
    }

    private reportUpdateResults(results: UpdateResult[]): void {
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
            console.error("Key Update Failures:", failures);
            new Notice(`Frontmatter key update completed with ${failures.length} error(s). See console.`, 0);
        } else {
            new Notice("Frontmatter key update completed successfully.", 5000);
        }
    }

    // -------------------------
    // Core per-file update logic
    // -------------------------

    /**
     * Update a vault file (TFile). Uses editor instance when file is active,
     * otherwise uses Vault API (app.vault.read/modify) for non-hidden files,
     * and adapter for hidden files.
     *
     * Ensures only one operation per file by enqueueing with file.path as the key.
     */
    private async updateVaultFile(file: TFile, oldKey: string, newKey: string): Promise<UpdateResult> {
        if (!file || !file.path) {
            return { success: false, path: String(file?.path ?? ''), error: 'Invalid file object' };
        }

        const op = async (): Promise<UpdateResult> => {
            try {
                const context = this.getFileOperationContext(file.path);
                
                // Read content
                const content = await this.readContent(file.path, context);
                if (typeof content !== 'string') {
                    return { success: false, path: file.path, error: 'Read returned non-string content' };
                }

                // Check if update is needed
                const updateNeeded = this.isUpdateNeeded(content, oldKey, newKey);
                if (!updateNeeded) {
                    return { success: true, path: file.path };
                }

                // Replace oldKey -> newKey inside frontmatter
                const newContent = this.replaceKeyInYamlFrontmatterPreservingEverything(content, oldKey, newKey);

                if (newContent !== content) {
                    await this.writeContent(file.path, newContent, context);
                }

                return { success: true, path: file.path };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { success: false, path: file.path, error: message };
            }
        };

        try {
            // Enqueue by file.path to ensure single concurrent operation per file.
            const queued = this.queueService.enqueue(file.path, op);
            const res = await this.wrapWithTimeout(queued, KeyUpdateManager.FILE_OP_TIMEOUT_MS, `Timeout updating vault file ${file.path}`);
            return res;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, path: file.path, error: message };
        }
    }

    /**
     * Update DB-version files for a given noteId. Uses adapter API for version files (they are usually in plugin storage).
     * We still enforce single-op-per-file by enqueueing with the exact file path.
     */
    private async updateDbFilesForNote(noteId: string, oldKey: string, newKey: string): Promise<UpdateResult[]> {
        const results: UpdateResult[] = [];
        if (!noteId || typeof noteId !== 'string') return results;

        const versionsPath = this.pathService.getNoteVersionsPath(noteId);
        let versionFiles: string[] = [];
        try {
            const listResult = await this.safeAdapterList(versionsPath);
            versionFiles = (listResult?.files ?? []).filter((f): f is string => typeof f === 'string' && f.endsWith('.md'));
        } catch (e) {
            // No versions folder or unreadable: nothing to do
            return results;
        }

        // Process files in batches to improve performance
        const batchSize = 10;
        for (let i = 0; i < versionFiles.length; i += batchSize) {
            const batch = versionFiles.slice(i, i + batchSize);
            const batchPromises = batch.map(async (filePath) => {
                if (!filePath || typeof filePath !== 'string') {
                    return { success: false, path: String(filePath), error: 'Invalid file path' } as UpdateResult;
                }

                const op = async (): Promise<UpdateResult> => {
                    try {
                        const context = this.getFileOperationContext(filePath);
                        const content = await this.readContent(filePath, context);
                        
                        if (typeof content !== 'string') {
                            return { success: false, path: filePath, error: 'Read returned non-string content' };
                        }

                        // Check if update is needed
                        const updateNeeded = this.isUpdateNeeded(content, oldKey, newKey);
                        if (!updateNeeded) {
                            return { success: true, path: filePath };
                        }

                        const newContent = this.replaceKeyInYamlFrontmatterPreservingEverything(content, oldKey, newKey);

                        if (newContent !== content) {
                            await this.writeContent(filePath, newContent, context);
                        }
                        return { success: true, path: filePath };
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        return { success: false, path: filePath, error: message };
                    }
                };

                try {
                    // Enqueue by filePath to ensure per-file single op
                    const queued = this.queueService.enqueue(filePath, op);
                    const res = await this.wrapWithTimeout(queued, KeyUpdateManager.FILE_OP_TIMEOUT_MS, `Timeout updating DB file ${filePath}`);
                    return res;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    return { success: false, path: filePath, error: message };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }

    // -------------------------
    // Read / write helpers (editor-aware + vault vs adapter)
    // -------------------------

    /**
     * Get the operation context for a file path
     */
    private getFileOperationContext(filePath: string): FileOperationContext {
        const isHidden = this.isPathHidden(filePath);
        const activeFile = this.app.workspace.getActiveFile();
        const isEditorActive = !isHidden && !!activeFile && activeFile.path === filePath;
        const file = isEditorActive ? activeFile : this.app.vault.getAbstractFileByPath(filePath) as TFile | undefined;
        
        return { isHidden, isEditorActive, file };
    }

    /**
     * Check if a file needs to be updated
     */
    private isUpdateNeeded(content: string, oldKey: string, newKey: string): boolean {
        // If newKey already present in frontmatter, skip edits
        if (this.frontMatterHasTopLevelKey(content, newKey)) {
            return false;
        }

        // If oldKey not present in frontmatter, nothing to do
        if (!this.frontMatterHasTopLevelKey(content, oldKey)) {
            return false;
        }

        return true;
    }

    /**
     * Read content for a path. Preference order:
     *  - If not hidden and file is active in workspace -> read from editor buffer
     *  - If not hidden and file exists as TFile in vault -> app.vault.read(TFile)
     *  - Else fall back to adapter.read(path)
     */
    private async readContent(filePath: string, context: FileOperationContext): Promise<string> {
        // Validate inputs
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Invalid filePath provided to readContent');
        }

        // Editor read when active and not hidden
        if (context.isEditorActive) {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.file && view.file.path === filePath) {
                const ed: Editor | undefined = view.editor;
                if (ed && typeof ed.getValue === 'function') {
                    const content = ed.getValue();
                    if (typeof content === 'string') {
                        return content;
                    }
                }
            }
        }

        // Try to read via Vault API if TFile exists
        if (context.file && !context.isHidden) {
            try {
                const content = await this.app.vault.read(context.file);
                if (typeof content === 'string') {
                    return content;
                }
            } catch {
                // Fall through to adapter.read
            }
        }

        // Fallback to adapter for hidden files or unknown TFile
        const content = await this.app.vault.adapter.read(filePath);
        if (typeof content !== 'string') {
            throw new Error(`Adapter read returned non-string content for ${filePath}`);
        }
        return content;
    }

    /**
     * Write content for a path. Preference order:
     *  - If not hidden and file is active in workspace -> update editor buffer and trigger view.save()
     *  - If not hidden and file exists as TFile -> app.vault.modify(TFile, content)
     *  - Else fall back to adapter.write(path, content)
     */
    private async writeContent(filePath: string, content: string, context: FileOperationContext): Promise<void> {
        // Validate inputs
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Invalid filePath provided to writeContent');
        }
        if (typeof content !== 'string') {
            throw new Error('Invalid content provided to writeContent');
        }

        // Editor path when active and not hidden
        if (context.isEditorActive) {
            try {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && view.file && view.file.path === filePath) {
                    const ed = view.editor;
                    if (ed && typeof ed.setValue === 'function') {
                        // Update editor buffer
                        ed.setValue(content);
                        // Save via the view's built-in save method
                        await view.save();
                        return;
                    }
                }
            } catch (e) {
                console.warn('Editor write failed, falling back to vault/adapter', e);
                // Fallthrough to vault/adapter
            }
        }

        // If file exists in vault as TFile, use vault.modify
        if (context.file && !context.isHidden) {
            try {
                await this.app.vault.modify(context.file, content);
                return;
            } catch (e) {
                console.warn('Vault modify failed, falling back to adapter', e);
                // Fallthrough to adapter
            }
        }

        // Fallback: adapter.write (used for hidden files or when all else fails)
        await this.app.vault.adapter.write(filePath, content);
    }

    // -------------------------
    // Utilities & text-processing
    // -------------------------

    private validateKeys(oldKey: string, newKey: string): string | undefined {
        if (!oldKey || typeof oldKey !== 'string') return 'oldKey must be a non-empty string';
        if (!newKey || typeof newKey !== 'string') return 'newKey must be a non-empty string';
        if (oldKey === newKey) return 'oldKey and newKey are identical; nothing to do';
        if (/[\\\r\n]/.test(oldKey) || /[\\\r\n]/.test(newKey)) return 'Keys must not contain newline/backslash characters';
        return undefined;
    }

    /**
     * Heuristic: consider a file path "hidden" if any path segment begins with '.'
     */
    private isPathHidden(filePath: string): boolean {
        if (!filePath || typeof filePath !== 'string') return false;
        const parts = filePath.split('/');
        return parts.some(p => p.startsWith('.'));
    }

    private safeGetMarkdownFiles(): TFile[] {
        try {
            const files = this.app.vault.getMarkdownFiles();
            if (!Array.isArray(files)) return [];
            return files.filter((file): file is TFile => 
                file instanceof TFile && 
                typeof file.path === 'string' && 
                file.path.length > 0
            );
        } catch (e) {
            console.error('safeGetMarkdownFiles failed', e);
            return [];
        }
    }

    private async safeGetAllNotesFromRepo(): Promise<Record<string, any>> {
        try {
            const notes = await this.centralManifestRepository.getAllNotes();
            return notes ?? {};
        } catch (e) {
            console.error('safeGetAllNotesFromRepo failed', e);
            return {};
        }
    }

    private async safeAdapterList(path: string): Promise<{ files: string[] } | undefined> {
        if (!path || typeof path !== 'string') return undefined;
        try {
            return await this.app.vault.adapter.list(path);
        } catch(e) {
            return undefined;
        }
    }

    private async wrapWithTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage = 'Operation timed out'): Promise<T> {
        if (ms <= 0) {
            throw new Error('Timeout duration must be positive');
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
        });

        try {
            const result = await Promise.race([promise, timeout]);
            if (timer) clearTimeout(timer);
            return result;
        } catch (err) {
            if (timer) clearTimeout(timer);
            throw err;
        }
    }

    /**
     * Run tasks with limited concurrency.
     * Reasonable defaults: MOBILE_CONCURRENCY on mobile-like UA, DESKTOP_CONCURRENCY otherwise.
     */
    private async runTasksWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
        if (!Array.isArray(tasks) || tasks.length === 0) return;

        const limit = Math.max(1, Math.min(Math.floor(concurrency), tasks.length) || 1);
        let idx = 0;
        const runners: Promise<void>[] = [];

        const worker = async (): Promise<void> => {
            while (true) {
                const cur = idx++;
                if (cur >= tasks.length) break;
                try {
                    const task = tasks[cur];
                    if (task) {
                        await task();
                    }
                } catch (e) {
                    console.error(`Task ${cur} failed`, e);
                }
            }
        };

        for (let i = 0; i < limit; i++) {
            runners.push(worker());
        }

        await Promise.all(runners);
    }

    /**
     * Determine concurrency according to platform heuristics.
     * Tries to detect mobile by userAgent, else assumes desktop.
     */
    private determineConcurrency(): number {
        try {
            if (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
                return KeyUpdateManager.MOBILE_CONCURRENCY;
            }
        } catch {
            // Ignore and fall through to desktop default
        }
        return KeyUpdateManager.DESKTOP_CONCURRENCY;
    }

    /**
     * Check whether top-level key exists inside frontmatter block.
     */
    private frontMatterHasTopLevelKey(content: string, key: string): boolean {
        if (!content || typeof content !== 'string') return false;
        if (!content.startsWith('---')) return false;

        const endIdx = this.findFrontMatterEndIndex(content);
        if (endIdx === -1) return false;

        const fm = content.substring(0, endIdx);
        const escapedKey = this.escapeRegExp(key);
        const lineRegex = this.getOrCreateRegex(`^\\s*${escapedKey}\\s*:`, 'm');
        return lineRegex.test(fm);
    }

    /**
     * Replace top-level key token(s) oldKey -> newKey inside ONLY the YAML frontmatter block at the start of the file,
     * preserving everything else (values, ordering, spacing, comments). If newKey exists inside frontmatter, no change.
     * Replaces all top-level occurrences of oldKey found in the frontmatter.
     */
    private replaceKeyInYamlFrontmatterPreservingEverything(content: string, oldKey: string, newKey: string): string {
        if (!content || typeof content !== 'string') return content;
        if (!content.startsWith('---')) return content;

        const endIdx = this.findFrontMatterEndIndex(content);
        if (endIdx === -1) return content;

        const fmBlock = content.substring(0, endIdx);
        const rest = content.substring(endIdx);

        if (this.frontMatterHasTopLevelKey(fmBlock, newKey)) {
            return content;
        }

        const lines = fmBlock.split(/\r?\n/);
        const escapedOldKey = this.escapeRegExp(oldKey);
        const keyLineRegex = this.getOrCreateRegex(`^(\\s*)(${escapedOldKey})(\\s*:\\s*)([\\s\\S]*)$`);

        let changed = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (typeof line !== 'string') continue;
            const m = keyLineRegex.exec(line);
            if (m) {
                const newLine = `${m[1]}${newKey}${m[3]}${m[4] ?? ''}`;
                if (newLine !== line) {
                    lines[i] = newLine;
                    changed = true;
                }
            }
        }

        if (!changed) return content;

        const newFmBlock = lines.join('\n');
        return newFmBlock + rest;
    }

    /**
     * Return index where the frontmatter block (starting at the beginning of the file) ends,
     * i.e. the character index at which content after the frontmatter begins.
     * Returns -1 if no closing '---' found.
     */
    private findFrontMatterEndIndex(content: string): number {
        if (!content || typeof content !== 'string') return -1;
        
        // Check cache first
        if (KeyUpdateManager.FRONTMATTER_CACHE.has(content)) {
            return KeyUpdateManager.FRONTMATTER_CACHE.get(content)!;
        }
        
        const lines = content.split(/\r?\n/);
        if (lines.length < 2) {
            KeyUpdateManager.FRONTMATTER_CACHE.set(content, -1);
            return -1;
        }
        if (!lines[0]?.startsWith('---')) {
            KeyUpdateManager.FRONTMATTER_CACHE.set(content, -1);
            return -1;
        }

        let charIdx = lines[0].length + 1; // Start after first line and its newline

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (typeof line !== 'string') continue;
            if (line.trim() === '---') {
                const result = charIdx + line.length;
                KeyUpdateManager.FRONTMATTER_CACHE.set(content, result);
                return result;
            }
            charIdx += line.length + 1; // Add length of current line and its newline
        }
        
        KeyUpdateManager.FRONTMATTER_CACHE.set(content, -1);
        return -1;
    }

    /**
     * Get or create a regex pattern from cache to improve performance
     */
    private getOrCreateRegex(pattern: string, flags?: string): RegExp {
        const key = `${pattern}|${flags ?? ''}`;
        if (!KeyUpdateManager.REGEX_CACHE.has(key)) {
            KeyUpdateManager.REGEX_CACHE.set(key, new RegExp(pattern, flags));
        }
        return KeyUpdateManager.REGEX_CACHE.get(key)!;
    }

    private escapeRegExp(value: string): string {
        if (!value || typeof value !== 'string') return '';
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private safeGetSetting<T>(accessor: () => T, defaultValue: T): T {
        try {
            const val = accessor();
            if (val === undefined || val === null) return defaultValue;
            return val;
        } catch (e) {
            console.warn('safeGetSetting failed', e);
            return defaultValue;
        }
    }
}
