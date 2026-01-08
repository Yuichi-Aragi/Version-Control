import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { ServiceRegistry } from '@/services-registry';
import type { VersionHistoryEntry, Change, DiffType, DiffTarget, HistorySettings, ViewMode, TimelineEvent, TimelineSettings } from '@/types';
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
 * Arguments for getTimeline query
 */
export interface TimelineQueryArgs {
    noteId: string;
    branchName: string;
    viewMode: ViewMode;
}

/**
 * Response for getTimeline query
 */
export interface TimelineResponse {
    events: TimelineEvent[];
    settings: TimelineSettings;
}

/**
 * Arguments for updateTimelineSettings mutation
 */
export interface UpdateTimelineSettingsArgs {
    noteId: string;
    branchName: string;
    viewMode: ViewMode;
    settings: Partial<TimelineSettings>;
}

/**
 * Default Timeline Settings
 */
const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
    showDescription: false,
    showName: true,
    showVersionNumber: true,
    showPreview: true,
    expandByDefault: false,
};

/**
 * Helper to execute a query with context awareness and retry logic.
 */
async function executeContextAwareQuery<T>(
    targetNoteId: string | null,
    operation: () => Promise<T>,
    retryCount = 2
): Promise<{ data: T } | { error: { status: string; error: string } }> {
    const services = ServiceRegistry.getInstance();
    const store = services.store;

    if (!store) {
        return { error: { status: 'CUSTOM_ERROR', error: 'Store not initialized' } };
    }

    const isContextValid = () => {
        if (targetNoteId) {
            const currentNoteId = store.getState().app.noteId;
            return currentNoteId === targetNoteId;
        }
        return true;
    };

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        if (!isContextValid()) {
            return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
        }

        try {
            const result = await operation();

            if (!isContextValid()) {
                return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
            }

            return { data: result };
        } catch (error) {
            const message = String(error);
            
            if (!isContextValid()) {
                return { error: { status: 'CUSTOM_ERROR', error: 'Context changed' } };
            }

            if (attempt === retryCount) {
                console.error(`RTK Query failed after ${retryCount} retries:`, error);
                return { error: { status: 'CUSTOM_ERROR', error: message } };
            }

            await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt)));
        }
    }

    return { error: { status: 'CUSTOM_ERROR', error: 'Unknown error' } };
}

/**
 * RTK Query API for Version and Edit History.
 */
export const historyApi = createApi({
    reducerPath: 'historyApi',
    baseQuery: fakeBaseQuery(),
    tagTypes: ['VersionHistory', 'EditHistory', 'Branches', 'Settings', 'Timeline'],
    keepUnusedDataFor: 0,
    refetchOnMountOrArgChange: true,
    endpoints: (builder) => ({
        getVersionHistory: builder.query<VersionHistoryEntry[], string>({
            queryFn: (noteId) => executeContextAwareQuery(noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const history = await services.versionManager.getVersionHistory(noteId);
                return orderBy(history, ['versionNumber'], ['desc']);
            }),
            providesTags: (_result, _error, noteId) => [{ type: 'VersionHistory', id: noteId }],
        }),

        getEditHistory: builder.query<VersionHistoryEntry[], string>({
            queryFn: (noteId) => executeContextAwareQuery(noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { editHistoryManager, manifestManager } = services;

                let noteManifest = await manifestManager.loadNoteManifest(noteId);

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
                await editHistoryManager.loadBranchFromDisk(noteId, activeBranch);
                let manifest = await editHistoryManager.getEditManifest(noteId);

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

        getEffectiveSettings: builder.query<HistorySettings, EffectiveSettingsArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { noteId, viewMode } = args;
                const type = viewMode === 'versions' ? 'version' : 'edit';
                
                if (!noteId) {
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

        getVersionContent: builder.query<string, VersionContentQueryArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { diffManager, editHistoryManager } = services;
                const { noteId, versionId, viewMode } = args;
                const decoder = new TextDecoder('utf-8');

                let rawContent: string | ArrayBuffer | null = null;

                if (viewMode === 'versions') {
                    rawContent = await diffManager.getContent(noteId, { id: versionId } as VersionHistoryEntry);
                } else {
                    rawContent = await editHistoryManager.getEditContent(noteId, versionId);
                }

                if (rawContent === null) {
                     throw new Error("Content not found");
                }

                return typeof rawContent === 'string' ? rawContent : decoder.decode(rawContent);
            }),
            keepUnusedDataFor: 0,
        }),

        getDiff: builder.query<Change[], DiffQueryArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { diffManager, editHistoryManager } = services;
                const { noteId, v1, v2, diffType, viewMode } = args;
                const decoder = new TextDecoder('utf-8');

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
            keepUnusedDataFor: 0,
        }),

        getTimeline: builder.query<TimelineResponse, TimelineQueryArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { timelineManager, manifestManager, editHistoryManager } = services;
                const { noteId, branchName, viewMode } = args;
                const source = viewMode === 'versions' ? 'version' : 'edit';

                let settings: TimelineSettings = { ...DEFAULT_TIMELINE_SETTINGS };
                try {
                    if (source === 'version') {
                        const manifest = await manifestManager.loadNoteManifest(noteId);
                        if (manifest) {
                            const branch = manifest.branches[branchName];
                            if (branch && branch.timelineSettings) {
                                settings = { ...settings, ...branch.timelineSettings };
                            }
                        }
                    } else {
                        const manifest = await editHistoryManager.getEditManifest(noteId);
                        if (manifest) {
                            const branch = manifest.branches[branchName];
                            if (branch && branch.timelineSettings) {
                                settings = { ...settings, ...branch.timelineSettings };
                            }
                        }
                    }
                } catch (error) {
                    console.error("VC: Failed to load timeline settings", error);
                }

                const events = await timelineManager.getOrGenerateTimeline(noteId, branchName, source);

                return { events, settings };
            }),
            providesTags: (_result, _error, { noteId }) => [{ type: 'Timeline', id: noteId }],
        }),

        updateTimelineSettings: builder.mutation<void, UpdateTimelineSettingsArgs>({
            queryFn: (args) => executeContextAwareQuery(args.noteId, async () => {
                const services = ServiceRegistry.getInstance();
                const { manifestManager, editHistoryManager } = services;
                const { noteId, branchName, viewMode, settings } = args;
                const source = viewMode === 'versions' ? 'version' : 'edit';

                if (source === 'version') {
                    await manifestManager.updateNoteManifest(noteId, (manifest) => {
                        const branch = manifest.branches[branchName];
                        if (branch) {
                            // Safely merge settings ensuring all required properties exist via default fallback
                            branch.timelineSettings = {
                                ...DEFAULT_TIMELINE_SETTINGS,
                                ...(branch.timelineSettings || {}),
                                ...settings
                            };
                        }
                    });
                } else {
                    const manifest = await editHistoryManager.getEditManifest(noteId);
                    if (manifest) {
                        const branch = manifest.branches[branchName];
                        if (branch) {
                            branch.timelineSettings = {
                                ...DEFAULT_TIMELINE_SETTINGS,
                                ...(branch.timelineSettings || {}),
                                ...settings
                            };
                            await editHistoryManager.saveEditManifest(noteId, manifest);
                        }
                    }
                }
                return;
            }),
            invalidatesTags: (_result, _error, { noteId }) => [{ type: 'Timeline', id: noteId }],
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
    useLazyGetDiffQuery,
    useGetTimelineQuery,
    useUpdateTimelineSettingsMutation
} = historyApi;
