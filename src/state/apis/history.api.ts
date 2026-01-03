import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { ServiceRegistry } from '@/services-registry';
import type { VersionHistoryEntry, Change, DiffType, DiffTarget, HistorySettings, ViewMode } from '@/types';
import { orderBy } from 'es-toolkit';
import { buildEditHistory, syncEditManifest } from '@/state/thunks/edit-history/helpers';
import { resolveSettings } from '@/state/utils/settingsUtils';

/**
 * Interface for Branch Data response
 */
export interface BranchData {
    currentBranch: string;
    availableBranches: string[];
}

/**
 * Arguments for getDiff query
 */
export interface DiffQueryArgs {
    noteId: string;
    v1: VersionHistoryEntry;
    v2: DiffTarget;
    diffType: DiffType;
    viewMode: 'versions' | 'edits';
}

/**
 * Arguments for getVersionContent query
 */
export interface VersionContentQueryArgs {
    noteId: string;
    versionId: string;
    viewMode: 'versions' | 'edits';
}

/**
 * Arguments for getEffectiveSettings query
 */
export interface EffectiveSettingsArgs {
    noteId: string | null;
    viewMode: ViewMode;
    branchName?: string;
}

/**
 * Helper to execute a query with context awareness and retry logic.
 * 
 * This wrapper ensures that:
 * 1. Queries are immediately aborted if the application context (active note) changes.
 * 2. Transient errors (e.g., worker busy, race conditions) are retried with backoff.
 * 3. Rapid context changes are handled gracefully by short-circuiting stale operations.
 * 
 * @param targetNoteId - The noteId this query is intended for. If null, it's treated as a global query.
 * @param operation - The async operation to execute.
 * @param retryCount - Number of retries on failure (default: 2).
 */
async function executeContextAwareQuery<T>(
    targetNoteId: string | null,
    operation: () => Promise<T>,
    retryCount = 2
): Promise<{ data: T } | { error: { status: string; error: string } }> {
    const services = ServiceRegistry.getInstance();
    const store = services.store;

    // If store isn't ready, we can't validate context, but we also shouldn't proceed.
    if (!store) {
        return { error: { status: 'CUSTOM_ERROR', error: 'Store not initialized' } };
    }

    // Helper to validate if the requested noteId matches the current app state
    const isContextValid = () => {
        // If the query targets a specific note, it must match the active note in Redux.
        if (targetNoteId) {
            const currentNoteId = store.getState().app.noteId;
            return currentNoteId === targetNoteId;
        }
        // If query is global (null noteId), it's always valid context-wise
        return true;
    };

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        // 1. Pre-execution Context Check
        // Abort immediately if the UI has already switched to a different note
        if (!isContextValid()) {
            return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
        }

        try {
            // 2. Execute Operation
            const result = await operation();

            // 3. Post-execution Context Check
            // Critical for async operations that might take time (like worker calls)
            if (!isContextValid()) {
                return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
            }

            return { data: result };
        } catch (error) {
            const message = String(error);
            
            // If context changed during error, abort immediately without retry
            if (!isContextValid()) {
                return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
            }

            // If this was the last attempt, fail
            if (attempt === retryCount) {
                console.error(`RTK Query failed after ${retryCount} retries:`, error);
                return { error: { status: 'CUSTOM_ERROR', error: message } };
            }

            // Exponential backoff for retries (50ms, 100ms, 200ms)
            // Short delays are preferred for UI responsiveness during rapid switching
            await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt)));
        }
    }

    return { error: { status: 'CUSTOM_ERROR', error: 'Unknown error' } };
}

/**
 * RTK Query API for Version and Edit History.
 * Replaces manual thunks to ensure fresh data and handle caching/invalidation automatically.
 */
export const historyApi = createApi({
    reducerPath: 'historyApi',
    baseQuery: fakeBaseQuery(),
    tagTypes: ['VersionHistory', 'EditHistory', 'Branches', 'Settings'],
    // Aggressive freshness: Data is considered stale immediately when unused, 
    // ensuring a refetch on component mount if data isn't active.
    keepUnusedDataFor: 0,
    refetchOnMountOrArgChange: true,
    endpoints: (builder) => ({
        /**
         * Fetches version history for a specific note.
         */
        getVersionHistory: builder.query<VersionHistoryEntry[], string>({
            queryFn: (noteId) => executeContextAwareQuery(noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const history = await services.versionManager.getVersionHistory(noteId);
                // Ensure consistent sorting
                return orderBy(history, ['versionNumber'], ['desc']);
            }),
            providesTags: (_result, _error, noteId) => [{ type: 'VersionHistory', id: noteId }],
        }),

        /**
         * Fetches edit history for a specific note.
         * Handles the complex logic of recovering manifests and syncing edit manifests.
         */
        getEditHistory: builder.query<VersionHistoryEntry[], string>({
            queryFn: (noteId) => executeContextAwareQuery(noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { editHistoryManager, manifestManager } = services;

                // 1. Get Note Manifest (Source of Truth for Current Branch)
                let noteManifest = await manifestManager.loadNoteManifest(noteId);

                // Lazy Recovery Logic
                if (!noteManifest) {
                    const centralManifest = await manifestManager.loadCentralManifest();
                    const centralEntry = centralManifest.notes[noteId];
                    if (centralEntry) {
                        try {
                            noteManifest = await manifestManager.recoverMissingNoteManifest(noteId, centralEntry.notePath);
                        } catch (e) {
                            console.error(`VC: Failed to recover manifest for note ${noteId}`, e);
                        }
                    }
                }

                if (!noteManifest) {
                    return [];
                }

                const activeBranch = noteManifest.currentBranch;

                // 2. Load cache from disk
                await editHistoryManager.loadBranchFromDisk(noteId, activeBranch);

                // 3. Get Edit Manifest
                let manifest = await editHistoryManager.getEditManifest(noteId);

                // 4. Sync/Initialize Edit Manifest Logic
                if (manifest) {
                    const syncResult = syncEditManifest(manifest, activeBranch);
                    if (syncResult.dirty) {
                        await editHistoryManager.saveEditManifest(noteId, manifest);
                    }
                }

                if (!manifest || !manifest.branches[activeBranch]?.versions) {
                    return [];
                }

                return buildEditHistory(manifest, noteId, activeBranch);
            }),
            providesTags: (_result, _error, noteId) => [{ type: 'EditHistory', id: noteId }],
        }),

        /**
         * Fetches branch information for a note.
         */
        getBranches: builder.query<BranchData, string>({
            queryFn: (noteId) => executeContextAwareQuery(noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const manifest = await services.manifestManager.loadNoteManifest(noteId);
                
                if (!manifest) {
                    return { currentBranch: '', availableBranches: [] };
                }

                return { 
                    currentBranch: manifest.currentBranch, 
                    availableBranches: Object.keys(manifest.branches) 
                };
            }),
            providesTags: (_result, _error, noteId) => [{ type: 'Branches', id: noteId }],
        }),

        /**
         * Fetches effective settings for a note context.
         * Used to ensure the UI always reflects the correct settings for the active note/branch/mode.
         */
        getEffectiveSettings: builder.query<HistorySettings, EffectiveSettingsArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { noteId, viewMode } = args;
                // Maps ViewMode to 'version' | 'edit'
                const type = viewMode === 'versions' ? 'version' : 'edit';
                
                if (!noteId) {
                    // Return global defaults if no note is active
                    const plugin = services.plugin;
                    const defaults = type === 'version' 
                        ? plugin.settings.versionHistorySettings 
                        : plugin.settings.editHistorySettings;
                    return { ...defaults, isGlobal: true };
                }

                return await resolveSettings(noteId, type, services);
            }),
            providesTags: ['Settings'],
        }),

        /**
         * Fetches content for a specific version or edit.
         */
        getVersionContent: builder.query<string, VersionContentQueryArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { diffManager, editHistoryManager } = services;
                const { noteId, versionId, viewMode } = args;
                const decoder = new TextDecoder('utf-8');

                let rawContent: string | ArrayBuffer | null = null;

                if (viewMode === 'versions') {
                    // For versions, we can use diffManager to fetch content (it handles version logic)
                    // We construct a dummy entry with just ID for fetching
                    rawContent = await diffManager.getContent(noteId, { id: versionId } as VersionHistoryEntry);
                } else {
                    // For edits, fetch directly from EditHistoryManager
                    rawContent = await editHistoryManager.getEditContent(noteId, versionId);
                }

                if (rawContent === null) {
                     throw new Error("Content not found");
                }

                return typeof rawContent === 'string' ? rawContent : decoder.decode(rawContent);
            }),
            keepUnusedDataFor: 0, // Don't cache content in Redux
        }),

        /**
         * Computes diff between two versions.
         * Fetches content internally to ensure freshness.
         */
        getDiff: builder.query<Change[], DiffQueryArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { diffManager, editHistoryManager } = services;
                const { noteId, v1, v2, diffType, viewMode } = args;
                const decoder = new TextDecoder('utf-8');

                // Helper to fetch content
                const fetchContent = async (target: DiffTarget): Promise<string> => {
                    if (target.id === 'current') {
                        const raw = await diffManager.getContent(noteId, target);
                        return typeof raw === 'string' ? raw : decoder.decode(raw);
                    }

                    let raw: string | ArrayBuffer | null = null;
                    if (viewMode === 'versions') {
                        raw = await diffManager.getContent(noteId, target as VersionHistoryEntry);
                    } else {
                        raw = await editHistoryManager.getEditContent(noteId, target.id);
                    }

                    if (raw === null) throw new Error(`Failed to fetch content for ${target.id}`);
                    return typeof raw === 'string' ? raw : decoder.decode(raw);
                };

                const [content1, content2] = await Promise.all([
                    fetchContent(v1),
                    fetchContent(v2)
                ]);

                return await diffManager.computeDiff(noteId, v1.id, v2.id, content1, content2, diffType);
            }),
            keepUnusedDataFor: 0, // Don't cache diffs in Redux, rely on DiffManager's cache
        }),
    }),
});

export const { 
    useGetVersionHistoryQuery, 
    useGetEditHistoryQuery, 
    useGetBranchesQuery,
    useGetVersionContentQuery,
    useGetDiffQuery,
    useGetEffectiveSettingsQuery,
    useLazyGetDiffQuery
} = historyApi;
