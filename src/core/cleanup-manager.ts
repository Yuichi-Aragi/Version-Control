import { App, TFile, moment, Component } from "obsidian";
import { orderBy } from 'lodash-es';
import { injectable, inject } from 'inversify';
import { ManifestManager } from "./manifest-manager";
import type { VersionControlSettings } from "../types";
import { NOTE_FRONTMATTER_KEY } from "../constants";
import { PluginEvents } from "./plugin-events";
import { PathService } from "./storage/path-service";
import { TYPES } from "../types/inversify.types";

/**
 * Manages all cleanup operations, such as removing old versions based on
 * retention policies and cleaning up data for orphaned (deleted) notes.
 * It operates in a decoupled manner by listening to events from the PluginEvents bus.
 * Extends Component to leverage automatic event listener cleanup.
 */
@injectable()
export class CleanupManager extends Component {
    private cleanupPromises = new Map<string, Promise<void>>();
    private isOrphanCleanupRunning = false;

    constructor(
        @inject(TYPES.App) private app: App,
        @inject(TYPES.ManifestManager) private manifestManager: ManifestManager,
        @inject(TYPES.SettingsProvider) private settingsProvider: () => VersionControlSettings,
        @inject(TYPES.EventBus) private eventBus: PluginEvents,
        @inject(TYPES.PathService) private pathService: PathService
    ) {
        super();
    }

    public initialize(): void {
        this.eventBus.on('version-saved', this.handleVersionSaved);
        this.register(() => this.eventBus.off('version-saved', this.handleVersionSaved));
    }

    private handleVersionSaved = (noteId: string): void => {
        this.scheduleCleanup(noteId);
    }

    public scheduleCleanup(noteId: string): void {
        if (this.cleanupPromises.has(noteId)) return;
        const cleanupPromise = this.performPerNoteCleanup(noteId)
            .catch(err => console.error(`VC: Error during scheduled cleanup for note ${noteId}.`, err))
            .finally(() => this.cleanupPromises.delete(noteId));
        this.cleanupPromises.set(noteId, cleanupPromise);
    }

    private async performPerNoteCleanup(noteId: string): Promise<void> {
        const s = this.settingsProvider();
        const { maxVersionsPerNote, autoCleanupOldVersions, autoCleanupDays } = s;

        if ((maxVersionsPerNote <= 0) && (!autoCleanupOldVersions || autoCleanupDays <= 0)) return;

        const noteManifest = await this.manifestManager.loadNoteManifest(noteId);
        if (!noteManifest?.versions || Object.keys(noteManifest.versions).length <= 1) return;

        const versions = orderBy(
            Object.entries(noteManifest.versions),
            ([, v]) => new Date(v.timestamp).getTime(),
            ['desc']
        );
        if (versions.length <= 1) return;

        const keep = new Set<string>();
        const del = new Set<string>();
        const cutoff = moment().subtract(autoCleanupDays, 'days');

        for (const [id, v] of versions) {
            const byCount = maxVersionsPerNote <= 0 || keep.size < maxVersionsPerNote;
            const byAge   = !autoCleanupOldVersions || autoCleanupDays <= 0 || moment(v.timestamp).isSameOrAfter(cutoff);
            (byCount && byAge ? keep : del).add(id);
        }

        // Ensure at least one version is kept.
        if (keep.size === 0 && versions.length) {
            const newestVersionId = versions[0]![0];   // <-- FIXED: non-null assertion
            del.delete(newestVersionId);
        }

        if (del.size === 0) return;

        // Update manifest
        await this.manifestManager.updateNoteManifest(noteId, m => {
            for (const id of del) delete m.versions[id];
            m.lastModified = new Date().toISOString();
            return m;
        });

        // Delete files (fire-and-forget best effort)
        const deletions = [...del].map(id =>
            this.pathService.getNoteVersionPath(noteId, id)
        ).map(p =>
            this.app.vault.adapter.exists(p)
                .then(ex => ex ? this.app.vault.adapter.remove(p) : null)
                .catch(e => console.error(`VC: Failed to delete version file ${p}`, e))
        );
        await Promise.allSettled(deletions);
        this.eventBus.trigger('version-deleted', noteId);
    }

    async cleanupOrphanedVersions(manualTrigger: boolean): Promise<{ count: number; success: boolean }> {
        const settings = this.settingsProvider();
        if (!settings.autoCleanupOrphanedVersions && !manualTrigger) return { count: 0, success: true };
        if (this.isOrphanCleanupRunning) return { count: 0, success: true };
        this.isOrphanCleanupRunning = true;

        try {
            const central = await this.manifestManager.loadCentralManifest(true);
            const notes = central?.notes;
            if (!notes) {
                console.warn('VC: Central manifest empty or invalid – skipping orphan cleanup.');
                return { count: 0, success: true };
            }

            const vcIdToPath = new Map<string, string>();
            const allPaths = new Set<string>();
            for (const file of this.app.vault.getMarkdownFiles()) {
                allPaths.add(file.path);
                const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_FRONTMATTER_KEY];
                if (typeof id === 'string' && id.trim()) vcIdToPath.set(id, file.path);
            }

            const toDelete: string[] = [];
            const toUpdate: { noteId: string; newPath: string }[] = [];

            for (const [id, data] of Object.entries(notes)) {
                if (!data || typeof data.notePath !== 'string') {
                    console.warn(`VC: Corrupt manifest entry ${id} – removing.`);
                    toDelete.push(id); continue;
                }
                const fileExists = allPaths.has(data.notePath);
                if (fileExists) {
                    const file = this.app.vault.getAbstractFileByPath(data.notePath) as TFile;
                    const frontId = this.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_FRONTMATTER_KEY];
                    const fid = typeof frontId === 'string' && frontId.trim() ? frontId : null;
                    if (fid !== id) toDelete.push(id);
                } else {
                    const newPath = vcIdToPath.get(id);
                    newPath ? toUpdate.push({ noteId: id, newPath }) : toDelete.push(id);
                }
            }

            if (toUpdate.length) {
                await Promise.allSettled(toUpdate.map(u => this.manifestManager.updateNotePath(u.noteId, u.newPath)));
                console.log(`VC: Self-healed ${toUpdate.length} renamed path(s).`);
            }
            if (toDelete.length) {
                await Promise.allSettled(toDelete.map(id => this.manifestManager.deleteNoteEntry(id)));
                toDelete.forEach(id => this.eventBus.trigger('history-deleted', id));
                console.log(`VC: Removed ${toDelete.length} orphaned histor${toDelete.length > 1 ? 'ies' : 'y'}.`);
            }
            return { count: toDelete.length, success: true };
        } catch (e) {
            console.error('VC: Unexpected error during orphan cleanup.', e);
            return { count: 0, success: false };
        } finally {
            this.isOrphanCleanupRunning = false;
        }
    }

    async completePendingCleanups(): Promise<void> {
        const pending = [...this.cleanupPromises.values()];
        if (pending.length) await Promise.allSettled(pending);
        this.cleanupPromises.clear();
    }
}
